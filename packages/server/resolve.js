/**
 * resolve.js — Generic $src module proxy + timing: "server" function proxy
 */

import { resolve, relative } from "node:path";

/**
 * Handle POST /__jsonsx_resolve__ — proxy $prototype + $src entries.
 */
export async function handleResolve(req, root) {
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { $src, $prototype, $export: xport, $base, ...config } = body;
  if (!$src) return new Response("Missing $src", { status: 400 });

  let moduleAbsPath;
  try {
    if ($base) {
      const docUrlPath = new URL($base).pathname;
      const docDir = docUrlPath.slice(0, docUrlPath.lastIndexOf("/") + 1);
      moduleAbsPath = resolve(resolve(root, "." + docDir), $src);
    } else {
      moduleAbsPath = resolve(root, $src);
    }
  } catch (e) {
    return new Response(`Cannot resolve $src "${$src}": ${e.message}`, { status: 400 });
  }

  // Rebase relative config paths from doc-relative to CWD-relative
  if ($base) {
    const docUrlPath = new URL($base).pathname;
    const docDir = docUrlPath.slice(0, docUrlPath.lastIndexOf("/") + 1);
    const docAbsDir = resolve(root, "." + docDir);
    for (const [k, v] of Object.entries(config)) {
      if (typeof v === "string" && (v.startsWith("./") || v.startsWith("../"))) {
        config[k] = "./" + relative(process.cwd(), resolve(docAbsDir, v));
      }
    }
  }

  let mod;
  try {
    mod = await import(moduleAbsPath);
  } catch (e) {
    return new Response(`Failed to import "${$src}": ${e.message}`, { status: 500 });
  }

  const exportName = xport ?? $prototype;
  const ExportedClass = mod[exportName] ?? mod.default?.[exportName];
  if (typeof ExportedClass !== "function") {
    return new Response(`Export "${exportName}" not found in "${$src}"`, { status: 500 });
  }

  try {
    const instance = new ExportedClass(config);
    const value =
      typeof instance.resolve === "function"
        ? await instance.resolve()
        : "value" in instance
          ? instance.value
          : instance;
    return Response.json(value);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

/**
 * Handle POST /__jsonsx_server__ — proxy timing: "server" function calls.
 * In dev mode, the runtime sends these instead of hitting the production Hono handler.
 */
export async function handleServerFunction(req, root) {
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { $src, $export: xport, $base, arguments: args = {} } = body;
  if (!$src || !xport) return new Response("Missing $src or $export", { status: 400 });

  let moduleAbsPath;
  try {
    if ($base) {
      const docUrlPath = new URL($base).pathname;
      const docDir = docUrlPath.slice(0, docUrlPath.lastIndexOf("/") + 1);
      moduleAbsPath = resolve(resolve(root, "." + docDir), $src);
    } else {
      moduleAbsPath = resolve(root, $src);
    }
  } catch (e) {
    return new Response(`Cannot resolve $src: ${e.message}`, { status: 400 });
  }

  let mod;
  try {
    mod = await import(moduleAbsPath);
  } catch (e) {
    return new Response(`Failed to import "${$src}": ${e.message}`, { status: 500 });
  }

  const fn = mod[xport] ?? mod.default?.[xport];
  if (typeof fn !== "function") {
    return new Response(`Export "${xport}" not found in "${$src}"`, { status: 500 });
  }

  try {
    const result = await fn(args);
    return Response.json(result ?? null);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
