/**
 * studio-api.js — Studio filesystem integration
 *
 * REST endpoints under /__studio/* that provide server-backed file operations
 * so the studio can work universally (not just Chrome with File System Access API).
 *
 * All paths are relative to the project root. Directory traversal above root is rejected.
 */

import { resolve, relative, basename, dirname } from "node:path";
import { readdir, stat, readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";

function assertUnderRoot(filePath, root) {
  const rel = relative(root, filePath);
  if (rel.startsWith("..") || rel.startsWith("/")) throw new Error("Path outside project root");
}

/**
 * Handle /__studio/* requests.
 */
export async function handleStudioApi(req, url, root) {
  const path = url.pathname;

  // Project metadata
  if (path === "/__studio/project" && req.method === "GET") {
    try {
      const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
      return Response.json({
        root,
        name: pkg.name ?? basename(root),
        workspaces: pkg.workspaces ?? [],
      });
    } catch {
      return Response.json({ root, name: basename(root), workspaces: [] });
    }
  }

  // List files
  if (path === "/__studio/files" && req.method === "GET") {
    const dir = url.searchParams.get("dir") ?? ".";
    const pattern = url.searchParams.get("glob");
    const absDir = resolve(root, dir);
    try {
      assertUnderRoot(absDir, root);
    } catch (e) {
      return Response.json({ error: e.message }, { status: 400 });
    }

    try {
      if (pattern) {
        const glob = new Bun.Glob(pattern);
        const files = [];
        for await (const match of glob.scan({ cwd: absDir, dot: false })) {
          const fp = resolve(absDir, match);
          try {
            const s = await stat(fp);
            if (!s.isDirectory()) {
              files.push({
                name: basename(match),
                path: relative(root, fp),
                size: s.size,
                modified: s.mtime.toISOString(),
              });
            }
          } catch {}
        }
        return Response.json(files);
      }

      const entries = await readdir(absDir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fp = resolve(absDir, entry.name);
        const s = await stat(fp);
        files.push({
          name: entry.name,
          path: relative(root, fp),
          type: entry.isDirectory() ? "directory" : "file",
          size: s.size,
          modified: s.mtime.toISOString(),
        });
      }
      return Response.json(files);
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Read file
  if (path === "/__studio/file" && req.method === "GET") {
    const fp = url.searchParams.get("path");
    if (!fp) return new Response("Missing path", { status: 400 });
    const abs = resolve(root, fp);
    try {
      assertUnderRoot(abs, root);
    } catch (e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      return Response.json({ content: await readFile(abs, "utf8"), path: relative(root, abs) });
    } catch (e) {
      return e.code === "ENOENT"
        ? new Response("Not found", { status: 404 })
        : Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Write file
  if (path === "/__studio/file" && req.method === "PUT") {
    const fp = url.searchParams.get("path");
    if (!fp) return new Response("Missing path", { status: 400 });
    const abs = resolve(root, fp);
    try {
      assertUnderRoot(abs, root);
    } catch (e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, await req.text(), "utf8");
      return Response.json({ ok: true, path: relative(root, abs) });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Delete file
  if (path === "/__studio/file" && req.method === "DELETE") {
    const fp = url.searchParams.get("path");
    if (!fp) return new Response("Missing path", { status: 400 });
    const abs = resolve(root, fp);
    try {
      assertUnderRoot(abs, root);
    } catch (e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      await unlink(abs);
      return Response.json({ ok: true, path: relative(root, abs) });
    } catch (e) {
      return e.code === "ENOENT"
        ? new Response("Not found", { status: 404 })
        : Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Rename file
  if (path === "/__studio/file/rename" && req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const { from, to } = body;
    if (!from || !to) return new Response("Missing from or to", { status: 400 });
    const absFrom = resolve(root, from);
    const absTo = resolve(root, to);
    try {
      assertUnderRoot(absFrom, root);
      assertUnderRoot(absTo, root);
    } catch (e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      await mkdir(dirname(absTo), { recursive: true });
      await rename(absFrom, absTo);
      return Response.json({ ok: true, from: relative(root, absFrom), to: relative(root, absTo) });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  return null;
}
