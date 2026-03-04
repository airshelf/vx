package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/hanwen/go-fuse/v2/fs"
	"github.com/hanwen/go-fuse/v2/fuse"
)

// TTLs for different resource types.
var (
	ttlList    = 30 * time.Second
	ttlSingle  = 60 * time.Second
	ttlLogs    = 5 * time.Second
	ttlDefault = 30 * time.Second
)

func ttlFor(path string) time.Duration {
	switch {
	case strings.HasSuffix(path, "/logs/build"):
		return 5 * time.Minute // build logs are mostly immutable
	case strings.HasSuffix(path, "/logs/runtime"):
		return ttlLogs
	case strings.HasSuffix(path, ".json"):
		return ttlList
	default:
		return ttlSingle
	}
}

// mcpFS is the root FUSE inode.
type mcpFS struct {
	fs.Inode
	client *MCPClient
	cache  *Cache
	scheme string // URI scheme, e.g. "vercel"
	tree   *fsTree
}

// fsTree represents the filesystem structure built from MCP resources.
type fsTree struct {
	children map[string]*fsTree
	isDir    bool
	// For files: the MCP URI to read.
	uri string
	// For template dirs: URI template pattern, e.g. "vercel://deployments/{url}"
	template string
	param    string // template parameter name, e.g. "url"
	// For _template_leaf: the filename to use inside param dirs.
	leafName string
	// For nested template dirs (e.g. {owner}/{repo}): the child of a resolved
	// param lookup should itself be a template dir with these settings.
	// "nested" children are the files/dirs that belong at the nested level.
	nestedParam    string
	nestedChildren map[string]*fsTree
	nestedLeaf     *fsTree // _template_leaf for nested level
}

func newFSTree() *fsTree {
	return &fsTree{children: make(map[string]*fsTree)}
}

func (t *fsTree) ensureDir(name string) *fsTree {
	if child, ok := t.children[name]; ok {
		child.isDir = true
		return child
	}
	child := newFSTree()
	child.isDir = true
	t.children[name] = child
	return child
}

func (t *fsTree) addFile(name string, uri string) {
	t.children[name] = &fsTree{
		children: make(map[string]*fsTree),
		uri:      uri,
	}
}

// BuildTree constructs the filesystem tree from MCP resource listings.
func BuildTree(scheme string, resources []MCPResource, templates []MCPResourceTemplate) *fsTree {
	root := newFSTree()
	root.isDir = true
	prefix := scheme + "://"

	// Static resources become files.
	// e.g. "vercel://deployments" → "deployments.json"
	for _, r := range resources {
		path := strings.TrimPrefix(r.URI, prefix)
		parts := strings.Split(path, "/")

		// Navigate to parent dir.
		node := root
		for _, p := range parts[:len(parts)-1] {
			node = node.ensureDir(p)
		}

		name := parts[len(parts)-1]
		ext := ".json"
		if r.MimeType == "text/plain" {
			ext = ""
		}
		node.addFile(name+ext, r.URI)
	}

	// Templates become directories with a marker.
	// e.g. "vercel://deployments/{url}" → deployments/ (template dir)
	// e.g. "vercel://deployments/{url}/logs/build" → deployments/{url}/logs/build
	for _, t := range templates {
		path := strings.TrimPrefix(t.URITemplate, prefix)
		parts := strings.Split(path, "/")

		node := root
		for i, p := range parts {
			if strings.HasPrefix(p, "{") && strings.HasSuffix(p, "}") {
				param := p[1 : len(p)-1]
				// Only set template/param once per directory node.
				if node.template == "" {
					node.template = t.URITemplate
					node.param = param
				}
				node.isDir = true
				if i+1 < len(parts) {
					remaining := parts[i+1:]
					registerTemplateTail(node, remaining, t.URITemplate, param, scheme)
				} else {
					// Template ends at param level — e.g. vercel://projects/{name}
					// Derive a singular name: "projects" → "project"
					leafName := singularize(parts[i-1])
					node.children["_template_leaf"] = &fsTree{
						children: make(map[string]*fsTree),
						uri:      t.URITemplate,
						leafName: leafName,
					}
				}
				break
			}
			node = node.ensureDir(p)
		}
	}

	return root
}

func singularize(s string) string {
	if strings.HasSuffix(s, "s") {
		return s[:len(s)-1]
	}
	return s
}

// registerTemplateTail registers the path structure after a template parameter.
// For "vercel://deployments/{url}/logs/build", after {url}, we register logs/build.
// For "github://repos/{owner}/{repo}/issues", handles nested params recursively.
func registerTemplateTail(paramDir *fsTree, remaining []string, uriTemplate string, param string, scheme string) {
	for i, p := range remaining {
		if strings.HasPrefix(p, "{") && strings.HasSuffix(p, "}") {
			nestedParam := p[1 : len(p)-1]
			// Store nested template info on the parent template dir.
			// These get applied when lookupTemplateChild resolves the first param.
			paramDir.nestedParam = nestedParam
			if paramDir.nestedChildren == nil {
				paramDir.nestedChildren = make(map[string]*fsTree)
			}
			if i+1 < len(remaining) {
				// Files/dirs after the nested param.
				registerNestedTail(paramDir, remaining[i+1:], uriTemplate)
			} else {
				// Template ends at the nested param level.
				paramDir.nestedLeaf = &fsTree{
					children: make(map[string]*fsTree),
					uri:      uriTemplate,
					leafName: nestedParam,
				}
			}
			return
		}
		// Non-param segments: these are direct children of the param dir.
		if i == len(remaining)-1 {
			paramDir.addFile(p, uriTemplate)
		} else {
			paramDir = paramDir.ensureDir(p)
		}
	}
}

// registerNestedTail adds files/dirs that go inside the nested template dir.
func registerNestedTail(paramDir *fsTree, remaining []string, uriTemplate string) {
	node := paramDir
	for i, p := range remaining {
		if i == len(remaining)-1 {
			node.nestedChildren[p] = &fsTree{
				children: make(map[string]*fsTree),
				uri:      uriTemplate,
			}
		} else {
			// Intermediate dir in nested children.
			if child, ok := node.nestedChildren[p]; ok {
				child.isDir = true
				node = &fsTree{children: child.children, isDir: true}
			} else {
				child := newFSTree()
				child.isDir = true
				node.nestedChildren[p] = child
				node = child
			}
		}
	}
}

// FUSE inode implementations.

// dirNode represents a directory in the FUSE tree.
type dirNode struct {
	fs.Inode
	fsys *mcpFS
	tree *fsTree
	// For template-parameterized dirs: the resolved parameter value.
	paramValues map[string]string
}

var _ = (fs.NodeLookuper)((*dirNode)(nil))
var _ = (fs.NodeReaddirer)((*dirNode)(nil))
var _ = (fs.NodeGetattrer)((*dirNode)(nil))

func (d *dirNode) Getattr(ctx context.Context, fh fs.FileHandle, out *fuse.AttrOut) syscall.Errno {
	out.Mode = 0555
	out.Nlink = 2
	return 0
}

func (d *dirNode) Readdir(ctx context.Context) (fs.DirStream, syscall.Errno) {
	var entries []fuse.DirEntry

	for name, child := range d.tree.children {
		if name == "_template_leaf" {
			continue
		}
		mode := uint32(syscall.S_IFREG | 0444)
		if child.isDir {
			mode = syscall.S_IFDIR | 0555
		}
		entries = append(entries, fuse.DirEntry{Name: name, Mode: mode})
	}

	return fs.NewListDirStream(entries), 0
}

func (d *dirNode) Lookup(ctx context.Context, name string, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	child, ok := d.tree.children[name]
	if ok {
		return d.buildInode(ctx, name, child, out)
	}

	// If this is a template dir, the name might be a parameter value.
	if d.tree.template != "" && d.tree.param != "" {
		return d.lookupTemplateChild(ctx, name, out)
	}

	return nil, syscall.ENOENT
}

func (d *dirNode) buildInode(ctx context.Context, name string, t *fsTree, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	if t.isDir {
		out.Mode = syscall.S_IFDIR | 0555
		out.Nlink = 2
		dn := &dirNode{
			fsys:        d.fsys,
			tree:        t,
			paramValues: copyParams(d.paramValues),
		}
		return d.NewInode(ctx, dn, fs.StableAttr{Mode: syscall.S_IFDIR}), 0
	}

	// File — resolve the URI.
	uri := t.uri
	uri = resolveURI(uri, d.paramValues)

	out.Mode = syscall.S_IFREG | 0444
	fn := &fileNode{fsys: d.fsys, uri: uri}
	return d.NewInode(ctx, fn, fs.StableAttr{Mode: syscall.S_IFREG}), 0
}

func (d *dirNode) lookupTemplateChild(ctx context.Context, name string, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	params := copyParams(d.paramValues)
	params[d.tree.param] = name

	childTree := newFSTree()
	childTree.isDir = true

	// If there's a nested template param (e.g. {owner}/{repo}),
	// the child dir becomes another template dir for the nested param.
	if d.tree.nestedParam != "" {
		childTree.template = d.tree.template
		childTree.param = d.tree.nestedParam
		// Copy nested children (files that go inside the nested param dir).
		for k, v := range d.tree.nestedChildren {
			childTree.children[k] = v
		}
		if d.tree.nestedLeaf != nil {
			childTree.children["_template_leaf"] = d.tree.nestedLeaf
		}
	} else {
		// No nesting — copy static children directly.
		for k, v := range d.tree.children {
			if k == "_template_leaf" {
				continue
			}
			childTree.children[k] = v
		}
		if leaf, ok := d.tree.children["_template_leaf"]; ok {
			childTree.addFile(leaf.leafName, leaf.uri)
		}
	}

	out.Mode = syscall.S_IFDIR | 0555
	out.Nlink = 2
	dn := &dirNode{
		fsys:        d.fsys,
		tree:        childTree,
		paramValues: params,
	}
	return d.NewInode(ctx, dn, fs.StableAttr{Mode: syscall.S_IFDIR}), 0
}

// fileNode represents a readable file backed by an MCP resource.
type fileNode struct {
	fs.Inode
	fsys *mcpFS
	uri  string
}

var _ = (fs.NodeOpener)((*fileNode)(nil))
var _ = (fs.NodeGetattrer)((*fileNode)(nil))
var _ = (fs.NodeReader)((*fileNode)(nil))

func (f *fileNode) Getattr(ctx context.Context, fh fs.FileHandle, out *fuse.AttrOut) syscall.Errno {
	data, err := f.readData()
	if err != nil {
		out.Size = 0
	} else {
		out.Size = uint64(len(data))
	}
	out.Mode = syscall.S_IFREG | 0444
	return 0
}

func (f *fileNode) Open(ctx context.Context, flags uint32) (fs.FileHandle, uint32, syscall.Errno) {
	return nil, fuse.FOPEN_KEEP_CACHE, 0
}

func (f *fileNode) Read(ctx context.Context, fh fs.FileHandle, dest []byte, off int64) (fuse.ReadResult, syscall.Errno) {
	data, err := f.readData()
	if err != nil {
		log.Printf("mcpfs: read %s: %v", f.uri, err)
		return nil, syscall.EIO
	}
	if off >= int64(len(data)) {
		return fuse.ReadResultData(nil), 0
	}
	end := off + int64(len(dest))
	if end > int64(len(data)) {
		end = int64(len(data))
	}
	return fuse.ReadResultData(data[off:end]), 0
}

func (f *fileNode) readData() ([]byte, error) {
	if data, ok := f.fsys.cache.Get(f.uri); ok {
		return data, nil
	}

	text, _, err := f.fsys.client.ReadResource(f.uri)
	if err != nil {
		return nil, err
	}

	data := []byte(text)
	f.fsys.cache.Set(f.uri, data, ttlFor(f.uri))
	return data, nil
}

// resolveURI replaces {param} placeholders in a URI template with actual values.
func resolveURI(uri string, params map[string]string) string {
	for k, v := range params {
		uri = strings.ReplaceAll(uri, "{"+k+"}", v)
	}
	return uri
}

func copyParams(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// Mount creates the FUSE mount and blocks until unmounted.
func Mount(mountpoint string, client *MCPClient, cache *Cache, debug bool) error {
	resources, err := client.ListResources()
	if err != nil {
		return fmt.Errorf("resources/list: %w", err)
	}
	templates, err := client.ListResourceTemplates()
	if err != nil {
		return fmt.Errorf("resources/templates/list: %w", err)
	}

	if len(resources) == 0 && len(templates) == 0 {
		return fmt.Errorf("server has no resources")
	}

	// Infer scheme from first resource URI.
	scheme := "mcp"
	if len(resources) > 0 {
		if idx := strings.Index(resources[0].URI, "://"); idx > 0 {
			scheme = resources[0].URI[:idx]
		}
	} else if len(templates) > 0 {
		if idx := strings.Index(templates[0].URITemplate, "://"); idx > 0 {
			scheme = templates[0].URITemplate[:idx]
		}
	}

	tree := BuildTree(scheme, resources, templates)

	root := &dirNode{
		fsys: &mcpFS{
			client: client,
			cache:  cache,
			scheme: scheme,
			tree:   tree,
		},
		tree:        tree,
		paramValues: make(map[string]string),
	}

	fmt.Fprintf(os.Stderr, "mcpfs: mounting %s:// at %s (%d resources, %d templates)\n",
		scheme, mountpoint, len(resources), len(templates))

	opts := &fs.Options{
		MountOptions: fuse.MountOptions{
			FsName: "mcpfs",
			Name:   scheme,
			Debug:  debug,
		},
	}

	server, err := fs.Mount(mountpoint, root, opts)
	if err != nil {
		return fmt.Errorf("mount: %w", err)
	}

	server.Wait()
	return nil
}
