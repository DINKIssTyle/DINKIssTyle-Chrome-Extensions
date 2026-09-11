/* Protect TeX before Markdown parsing so underscores, pipes and line breaks survive. */
(() => {
  function protect(source) {
    let prefix = '\uE000AIANGMATH';
    while (source.includes(prefix)) prefix += 'X';
    const entries = [];
    // Code takes precedence. Escaped dollars and ordinary currency stay literal.
    const pattern = /(^[ \t]*```[^\n]*\n[\s\S]*?(?:^[ \t]*```[ \t]*(?=\n|$)|$(?![\s\S]))|`[^`\n]*`|\\\\|\\\$|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([^\n]+?\\\)|\$(?!\s|\$)(?:\\[^\n]|[^$\n\\])*?[^\s\\$]\$(?!\d)|\$[^\s$\\]\$(?!\d))/gm;
    const text = source.replace(pattern, raw => {
      const display = raw.startsWith('$$') || raw.startsWith('\\[');
      if (!display && !raw.startsWith('\\(') && !raw.startsWith('$')) return raw;
      const width = display || raw.startsWith('\\(') ? 2 : 1;
      const key = `${prefix}${entries.length}\uE001`;
      entries.push({ key, raw, tex: raw.slice(width, -width), display });
      return key;
    });
    return { text, entries, prefix };
  }

  function restore(container, prepared) {
    if (!prepared.entries.length) return;
    const document = container.ownerDocument;
    const walker = document.createTreeWalker(container, 4 /* SHOW_TEXT */);
    const nodes = [];
    while (walker.nextNode()) {
      if (walker.currentNode.data.includes(prepared.prefix)) nodes.push(walker.currentNode);
    }
    const byKey = new Map(prepared.entries.map(entry => [entry.key, entry]));
    const pattern = new RegExp(`${prepared.prefix}\\d+\uE001`, 'g');
    for (const node of nodes) {
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of node.data.matchAll(pattern)) {
        fragment.append(document.createTextNode(node.data.slice(offset, match.index)));
        const entry = byKey.get(match[0]);
        if (node.parentElement.closest('code, pre')) {
          fragment.append(document.createTextNode(entry.raw));
          offset = match.index + match[0].length;
          continue;
        }
        const element = document.createElement('span');
        element.className = entry.display ? 'aiang-math aiang-math-display' : 'aiang-math';
        try {
          globalThis.katex.render(entry.tex, element, {
            displayMode: entry.display, throwOnError: true, trust: false,
            strict: 'ignore', maxExpand: 1000, maxSize: 20
          });
        } catch {
          // An incomplete or unsupported formula must not hide the rest of the answer.
          element.textContent = entry.raw;
        }
        fragment.append(element);
        offset = match.index + match[0].length;
      }
      fragment.append(document.createTextNode(node.data.slice(offset)));
      node.replaceWith(fragment);
    }
  }

  globalThis.AIAngMath = { protect, restore };
})();
