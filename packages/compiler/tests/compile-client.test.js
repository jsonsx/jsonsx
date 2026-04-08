import { describe, test, expect } from "bun:test";
import { compileClient } from "../compile-client.js";

describe("compileClient", () => {
  test("compiles counter example to pre-rendered HTML with bindings", () => {
    const counter = {
      $defs: {
        count: { type: "integer", default: 0, description: "Current counter value" },
        label: {
          $prototype: "Function",
          body: "const c = $defs.count; return c > 0 ? 'Clicked ' + c + ' time' + (c === 1 ? '' : 's') : 'Click me!';",
          signal: true,
        },
        increment: { $prototype: "Function", body: "$defs.count++" },
        decrement: { $prototype: "Function", body: "$defs.count = Math.max(0, $defs.count - 1)" },
        reset: { $prototype: "Function", body: "$defs.count = 0" },
      },
      tagName: "div",
      style: { display: "block", fontFamily: "system-ui, sans-serif" },
      children: [
        {
          tagName: "h1",
          textContent: { $ref: "#/$defs/label" },
          style: { fontSize: "1.5rem", color: "#333" },
        },
        {
          tagName: "p",
          textContent: "${$defs.count}",
          style: { fontSize: "3rem", fontWeight: "bold" },
        },
        {
          tagName: "div",
          style: { display: "flex", gap: "0.5rem" },
          children: [
            { tagName: "button", textContent: "\u2212", onclick: { $ref: "#/$defs/decrement" } },
            { tagName: "button", textContent: "+", onclick: { $ref: "#/$defs/increment" } },
            { tagName: "button", textContent: "Reset", onclick: { $ref: "#/$defs/reset" } },
          ],
        },
      ],
    };

    const result = compileClient(counter, {
      title: "Counter",
      reactivitySrc: "https://esm.sh/@vue/reactivity@3.5.32",
    });

    // Should produce HTML and one JS file
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("app.js");

    // HTML should contain data-bind markers
    expect(result.html).toContain("data-bind");
    expect(result.html).toContain(":textContent=");
    expect(result.html).toContain("@click=");

    // HTML should contain pre-rendered static content
    expect(result.html).toContain("<h1");
    expect(result.html).toContain("<button");

    // HTML should NOT contain lit-html or custom element registration
    expect(result.html).not.toContain("lit-html");
    expect(result.html).not.toContain("customElements.define");

    // JS module should have reactive $defs, bind, on
    const js = result.files[0].content;
    expect(js).toContain("const $defs = reactive({");
    expect(js).toContain("count: 0,");
    expect(js).toContain("const bind = {");
    expect(js).toContain("const on = {");
    expect(js).toContain("hydrate(document)");

    // Should NOT contain the whole expanded signal object
    expect(js).not.toContain('"type":"integer"');
  });

  test("extracts default from expanded signals", () => {
    const doc = {
      $defs: {
        name: { type: "string", default: "World", description: "Name to greet" },
      },
      tagName: "div",
      children: [
        { tagName: "span", textContent: "${$defs.name}" },
      ],
    };

    const result = compileClient(doc, { title: "Test" });
    const js = result.files[0].content;

    // Should use "World" as the default, not the full object
    expect(js).toContain('name: "World"');
    expect(js).not.toContain('"type":"string"');
  });

  test("handles $ref textContent correctly", () => {
    const doc = {
      $defs: {
        label: {
          $prototype: "Function",
          body: "return 'Hello';",
          signal: true,
        },
      },
      tagName: "div",
      children: [
        { tagName: "h1", textContent: { $ref: "#/$defs/label" } },
      ],
    };

    const result = compileClient(doc, { title: "Test" });

    // h1 should have data-bind and :textContent binding
    expect(result.html).toContain('data-bind');
    expect(result.html).toContain(':textContent="label"');
    // Should NOT contain [object Object]
    expect(result.html).not.toContain("[object Object]");
  });

  test("handles event handlers with $ref", () => {
    const doc = {
      $defs: {
        doSomething: { $prototype: "Function", body: "console.log('clicked')" },
      },
      tagName: "div",
      children: [
        { tagName: "button", textContent: "Click", onclick: { $ref: "#/$defs/doSomething" } },
      ],
    };

    const result = compileClient(doc, { title: "Test" });

    expect(result.html).toContain('@click="doSomething"');
    expect(result.html).toContain("data-bind");
  });

  test("handles inline event handlers", () => {
    const doc = {
      $defs: { count: 0 },
      tagName: "div",
      children: [
        {
          tagName: "button",
          textContent: "+",
          onclick: { $prototype: "Function", body: "$defs.count++" },
        },
      ],
    };

    const result = compileClient(doc, { title: "Test" });

    // Should create an anonymous handler in the `on` object
    expect(result.html).toContain("data-bind");
    expect(result.html).toContain("@click=");
    const js = result.files[0].content;
    expect(js).toContain("$defs.count++");
  });

  test("handles dynamic style properties", () => {
    const doc = {
      $defs: { color: "red" },
      tagName: "div",
      children: [
        {
          tagName: "span",
          textContent: "Hello",
          style: { color: "${$defs.color}", fontSize: "1rem" },
        },
      ],
    };

    const result = compileClient(doc, { title: "Test" });

    // Static style should be inline
    expect(result.html).toContain("font-size: 1rem");
    // Dynamic style should be a binding
    expect(result.html).toContain(":style.color=");
    expect(result.html).toContain("data-bind");
  });

  test("skips schema-only type defs", () => {
    const doc = {
      $defs: {
        nameType: { type: "string", minLength: 1, maxLength: 100 },
        count: 0,
      },
      tagName: "div",
      children: [
        { tagName: "span", textContent: "${$defs.count}" },
      ],
    };

    const result = compileClient(doc, { title: "Test" });
    const js = result.files[0].content;

    // Should skip nameType (schema-only), include count
    expect(js).toContain("count: 0");
    expect(js).not.toContain("nameType");
  });

  test("static node without dynamic values has no data-bind", () => {
    const doc = {
      $defs: { count: 0 },
      tagName: "div",
      children: [
        { tagName: "p", textContent: "Static text" },
        { tagName: "span", textContent: "${$defs.count}" },
      ],
    };

    const result = compileClient(doc, { title: "Test" });

    // The <p> should NOT have data-bind (it's fully static)
    expect(result.html).toContain("<p>Static text</p>");
    // The <span> should have data-bind
    expect(result.html).toMatch(/<span[^>]*data-bind/);
  });
});
