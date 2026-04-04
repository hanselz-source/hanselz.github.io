/**
 * Shared script for project detail pages.
 *
 * Each project HTML file is a thin shell — it just calls:
 *   bootProjectPage("wireguard")
 *
 * This script fetches the matching .md file, parses it with the same
 * lightweight markdown renderer used by the main terminal, and displays
 * it inside the terminal chrome.  A small command handler supports
 * "back", "clear", and "help".
 */

// ---- Inline markdown parser (same logic as terminal.js) ----

function _escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function _inlineFmt(text) {
  return text
    .replace(/`([^`]+)`/g, '<span class="term-code">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<span class="t-bright t-bold">$1</span>');
}

function _parseMarkdown(md, basePath) {
  const lines = md.split("\n");
  let html = "";
  let inCodeBlock = false;
  let codeBuffer = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        html += '<div class="term-codeblock">' + _escHtml(codeBuffer.trimEnd()) + "</div>\n";
        codeBuffer = "";
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) { codeBuffer += line + "\n"; continue; }
    if (!line.trim()) continue;

    if (line.startsWith("### ")) {
      html += '<span class="writeup-h3">' + _inlineFmt(line.slice(4)) + "</span>\n";
      continue;
    }
    if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      if (heading === "Tools Used") {
        html += '<span class="writeup-h2">Tools Used</span>\n';
        i++;
        while (i < lines.length && !lines[i].trim()) i++;
        if (i < lines.length) {
          const tools = lines[i].split(",").map(function (t) { return t.trim(); }).filter(Boolean);
          html += '<div class="tools-list">' + tools.map(function (t) { return '<span class="tool-tag">' + t + "</span>"; }).join("") + "</div>\n";
        }
        continue;
      }
      html += '<span class="writeup-h2">' + _inlineFmt(heading) + "</span>\n";
      continue;
    }
    if (line.startsWith("# ")) {
      html += '<span class="writeup-h2">' + _inlineFmt(line.slice(2)) + "</span>\n";
      if (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].startsWith("#") && !lines[i + 1].startsWith("!") && !lines[i + 1].startsWith("```")) {
        i++;
        html += '<span class="t-muted">' + _inlineFmt(lines[i]) + "</span>\n";
      }
      continue;
    }

    var imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      var src = imgMatch[2];
      if (basePath && !src.startsWith("http")) src = basePath + "/" + src;
      html += '<img src="' + src + '" alt="' + imgMatch[1] + '" class="term-img">\n';
      continue;
    }

    var para = line;
    while (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].startsWith("#") && !lines[i + 1].startsWith("```") && !lines[i + 1].match(/^!\[/)) {
      i++;
      para += " " + lines[i];
    }
    html += '<span class="writeup-p">' + _inlineFmt(para) + "</span>\n";
  }
  return html;
}

// ---- Project page boot ----

function bootProjectPage(projectId) {
  var output = document.getElementById("output");
  var input = document.getElementById("command-input");
  var terminal = document.getElementById("terminal");

  // Day / night
  var hour = new Date().getHours();
  document.documentElement.setAttribute("data-time", (hour < 6 || hour >= 18) ? "night" : "day");

  function scrollToBottom() { terminal.scrollTop = terminal.scrollHeight; }

  function print(html) {
    var div = document.createElement("div");
    div.className = "output-block";
    div.innerHTML = html;
    output.appendChild(div);
    scrollToBottom();
  }

  function printLines(lines, delay) {
    return new Promise(function (resolve) {
      var i = 0;
      (function next() {
        if (i >= lines.length) return resolve();
        print(lines[i++]);
        setTimeout(next, delay);
      })();
    });
  }

  // Fetch and render
  input.disabled = true;

  (async function () {
    var bootLines = [
      '<span class="boot-line"><span class="boot-label">Reading project:</span> <span class="t-green">' + projectId + "</span></span>",
      '<span class="boot-line"><span class="boot-label">Loading writeup...</span> <span class="boot-ok">done</span></span>',
      "",
    ];
    await printLines(bootLines, 50);

    try {
      var res = await fetch(projectId + ".md");
      if (!res.ok) throw new Error("HTTP " + res.status);
      var md = await res.text();
      // basePath is empty string because images are relative to projects/
      var rendered = _parseMarkdown(md, "");
      print(
        '<div class="output-block"><div class="cmd-echo"><span class="prompt">visitor@mud.dev:~/projects$&nbsp;</span><span class="cmd-text">cat ' +
        projectId +
        '.md</span></div><div class="cmd-result">' +
        rendered +
        "</div></div>"
      );
    } catch (e) {
      print('<span class="t-red">Failed to load writeup: ' + _escHtml(String(e)) + "</span>");
    }

    print('\n<span class="t-muted">Type</span> <span class="t-green">back</span> <span class="t-muted">to return home, or</span> <span class="t-green">help</span> <span class="t-muted">for commands.</span>');
    input.disabled = false;
    input.focus();
  })();

  // Mini command handler
  var history = [];
  var historyIndex = -1;

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var val = input.value.trim().toLowerCase();
      input.value = "";
      if (!val) return;
      history.push(val);
      historyIndex = history.length;

      if (val === "back" || val === "cd .." || val === "home") {
        window.location.href = "../index.html";
      } else if (val === "clear") {
        output.innerHTML = "";
      } else if (val === "help") {
        var block = document.createElement("div");
        block.className = "output-block";
        block.innerHTML =
          '<div class="cmd-echo"><span class="prompt">visitor@mud.dev:~/projects$&nbsp;</span><span class="cmd-text">' +
          val +
          '</span></div><div class="cmd-result"><div class="help-grid">' +
          '<div class="help-row"><span class="help-cmd">back</span><span class="help-desc">Return to home terminal</span></div>' +
          '<div class="help-row"><span class="help-cmd">clear</span><span class="help-desc">Clear the terminal</span></div>' +
          '<div class="help-row"><span class="help-cmd">help</span><span class="help-desc">Show this message</span></div>' +
          "</div></div>";
        output.appendChild(block);
      } else {
        var block2 = document.createElement("div");
        block2.className = "output-block";
        block2.innerHTML =
          '<div class="cmd-echo"><span class="prompt">visitor@mud.dev:~/projects$&nbsp;</span><span class="cmd-text">' +
          val +
          '</span></div><div class="cmd-result"><span class="t-red">Command not found.</span> <span class="t-muted">Type</span> <span class="t-green">back</span> <span class="t-muted">to return home.</span></div>';
        output.appendChild(block2);
      }
      scrollToBottom();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndex > 0) { historyIndex--; input.value = history[historyIndex]; }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex < history.length - 1) { historyIndex++; input.value = history[historyIndex]; }
      else { historyIndex = history.length; input.value = ""; }
    }
  });

  terminal.addEventListener("click", function (e) {
    if (!e.target.closest("a")) input.focus();
  });
}
