(function () {
	"use strict";

	// =============================================
	//  State
	// =============================================
	const state = {
		history: [],
		historyIndex: -1,
		booted: false,
	};

	// =============================================
	//  DOM refs
	// =============================================
	const $ = (s) => document.querySelector(s);
	const output = $("#output");
	const input = $("#command-input");
	const terminal = $("#terminal");
	const titleEl = $("#terminal-title");

	// =============================================
	//  Day / Night detection
	// =============================================
	function applyTimeTheme() {
		const hour = new Date().getHours();
		const isNight = hour < 6 || hour >= 18;
		document.documentElement.setAttribute("data-time", isNight ? "night" : "day");
		return isNight;
	}

	// =============================================
	//  Utility helpers
	// =============================================
	function scrollToBottom() {
		terminal.scrollTop = terminal.scrollHeight;
	}

	function escHtml(s) {
		const d = document.createElement("div");
		d.textContent = s;
		return d.innerHTML;
	}

	function print(html) {
		const div = document.createElement("div");
		div.className = "output-block";
		div.innerHTML = html;
		output.appendChild(div);
		scrollToBottom();
	}

	function printLines(lines, delay = 30) {
		return new Promise((resolve) => {
			let i = 0;
			function next() {
				if (i >= lines.length) return resolve();
				print(lines[i]);
				i++;
				setTimeout(next, delay);
			}
			next();
		});
	}

	function printCommand(cmd, result) {
		const now = new Date();
		const hh = now.getHours();
		const mm = now.getMinutes();

		const block = document.createElement("div");
		block.className = "output-block";
		block.innerHTML =
			`<div class="cmd-echo">` +
			`<span class="prompt">[ ${hh}:${mm} ]</span>` +
			`<span style="color: #ffaf00;">&nbsp;visitor&nbsp;</span>` +
			`<span class="prompt">&lt;&nbsp;<span style="color: #808080">~</span>&nbsp;&gt;&nbsp;==&gt;&nbsp;</span>` +
			`<span class="cmd-text">${escHtml(cmd)}</span>` +
			`</div>` +
			(result ? `<div class="cmd-result">${result}</div>` : "");

		output.appendChild(block);
		scrollToBottom();
	}
	// =============================================
	//  Lightweight Markdown -> Terminal HTML
	// =============================================

	/**
	 * Convert inline markdown (backticks, bold) to terminal HTML.
	 */
	function inlineFmt(text) {
		return text
			.replace(/`([^`]+)`/g, '<span class="term-code">$1</span>')
			.replace(/\*\*([^*]+)\*\*/g, '<span class="t-bright t-bold">$1</span>');
	}

	/**
	 * Parse a markdown string into terminal-styled HTML.
	 *
	 * @param {string} md       Raw markdown content
	 * @param {string} basePath Path prefix for relative image URLs (e.g. "projects")
	 * @returns {string}        HTML string
	 */
	function parseMarkdown(md, basePath) {
		const lines = md.split("\n");
		let html = "";
		let inCodeBlock = false;
		let codeBuffer = "";

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// ---- fenced code blocks ----
			if (line.startsWith("```")) {
				if (inCodeBlock) {
					html += `<div class="term-codeblock">${escHtml(codeBuffer.trimEnd())}</div>\n`;
					codeBuffer = "";
					inCodeBlock = false;
				} else {
					inCodeBlock = true;
				}
				continue;
			}
			if (inCodeBlock) {
				codeBuffer += line + "\n";
				continue;
			}

			// ---- blank line ----
			if (!line.trim()) continue;

			// ---- headings ----
			if (line.startsWith("### ")) {
				html += `<span class="writeup-h3">${inlineFmt(line.slice(4))}</span>\n`;
				continue;
			}
			if (line.startsWith("## ")) {
				const heading = line.slice(3).trim();

				// Special case: "## Tools Used" renders the next line as pill tags
				if (heading === "Tools Used") {
					html += `<span class="writeup-h2">Tools Used</span>\n`;
					// advance past blank lines to the content line
					i++;
					while (i < lines.length && !lines[i].trim()) i++;
					if (i < lines.length) {
						const tools = lines[i].split(",").map((t) => t.trim()).filter(Boolean);
						html += `<div class="tools-list">${tools.map((t) => `<span class="tool-tag">${t}</span>`).join("")}</div>\n`;
					}
					continue;
				}

				html += `<span class="writeup-h2">${inlineFmt(heading)}</span>\n`;
				continue;
			}
			if (line.startsWith("# ")) {
				html += `<span class="writeup-h2">${inlineFmt(line.slice(2))}</span>\n`;
				// The line immediately after the title is usually the tech subtitle
				if (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].startsWith("#") && !lines[i + 1].startsWith("!") && !lines[i + 1].startsWith("```")) {
					i++;
					html += `<span class="t-muted">${inlineFmt(lines[i])}</span>\n`;
				}
				continue;
			}

			// ---- images ----
			const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
			if (imgMatch) {
				let src = imgMatch[2];
				if (basePath && !src.startsWith("http")) src = basePath + "/" + src;
				html += `<img src="${src}" alt="${imgMatch[1]}" class="term-img">\n`;
				continue;
			}

			// ---- paragraph (collect consecutive plain lines) ----
			let para = line;
			while (
				i + 1 < lines.length &&
				lines[i + 1].trim() &&
				!lines[i + 1].startsWith("#") &&
				!lines[i + 1].startsWith("```") &&
				!lines[i + 1].match(/^!\[/)
			) {
				i++;
				para += " " + lines[i];
			}
			html += `<span class="writeup-p">${inlineFmt(para)}</span>\n`;
		}

		return html;
	}

	/**
	 * Fetch a project markdown file and return rendered HTML.
	 * Uses basePath to fix relative image URLs when called from the root index.
	 */
	async function fetchWriteup(projectId) {
		const url = `projects/${projectId}.md`;
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(res.status);
			const md = await res.text();
			return parseMarkdown(md, "projects");
		} catch (e) {
			return `<span class="t-red">Failed to load writeup: ${escHtml(url)}</span>\n<span class="t-muted">${escHtml(String(e))}</span>`;
		}
	}

	// =============================================
	//  Portfolio Data
	//
	//  To add a new project:
	//    1. Create  projects/<id>.md
	//    2. Add an entry here with matching id
	// =============================================
	const data = {
		about: `I'm a cybersecurity student at the University of South Florida with a thing for breaking down how systems work (and how they break). Outside of class I run the Japanese Language Study Club, tinker with my home lab, and study Japanese. I spent a summer at Sophia University in Tokyo, and that experience shaped how I think about communication and problem-solving across cultures.`,

		now: [
			"Studying towards CompTIA Security+.",
			"Steadily improving this website.",
			"Preparing for the JLPT N2 exam.",
		],

		education: [
			{
				school: "University of South Florida (USF), Tampa, FL",
				date: "Expected June 2027",
				detail: "College of Engineering | B.S. in Cybersecurity | GPA: 3.54/4.00",
				coursework: "Information Security and IT Risk Management, Hands-On Cybersecurity, Advanced Program Design (C), Object Oriented Programming (Python)",
			},
			{
				school: "Sophia University, Tokyo, Japan",
				date: "July 2024",
				detail: "Summer Session in Japanese Language",
				coursework: "",
			},
		],

		skills: [
			{ cat: "Security & Risk", items: "Security controls, risk management, vulnerability assessment, security auditing, network analysis, systems administration, compliance documentation" },
			{ cat: "Frameworks & Standards", items: "NIST CSF, risk management frameworks" },
			{ cat: "Programming & Scripting", items: "Python, Bash, SQL, C, JavaScript, Lua" },
			{ cat: "Operating Systems", items: "Windows, Linux (Ubuntu, Kali), macOS" },
			{ cat: "Security Tools", items: "Wireshark, Nmap, Snort (IDS), SSH, Metasploit, WireGuard VPN" },
			{ cat: "Productivity", items: "Microsoft Office Suite (Word, Excel, PowerPoint)" },
		],

		leadership: [
			{
				title: "President",
				org: "Japanese Language Study Club (JLSC), USF",
				date: "Jan 2026 - Present",
				bullets: [
					"Lead 5+ officers and oversee operations for 100+ members; manage communications, coordinate multiple concurrent projects, and maintain high attention to detail across all organizational functions.",
					"Collaborate across diverse teams and disciplines, demonstrating adaptability, initiative, and strong interpersonal skills in a client-facing leadership role.",
				],
			},
			{
				title: "Treasurer",
				org: "Japanese Language Study Club (JLSC), USF",
				date: "Apr 2024 - Jan 2026",
				bullets: [
					"Built the organization's first formal budget and financial tracking system; managed all income, expenditures, and reimbursement documentation with strong attention to detail and organizational skills.",
					"Ensured full compliance with university financial policies and audit requirements, developing practical experience in analytical problem-solving, accountability, and multi-tasking in a fast-paced environment.",
				],
			},
		],

		// -------------------------------------------------
		//  PROJECTS
		//  id must match the .md filename in projects/
		// -------------------------------------------------
		projects: [
			{
				id: "wireguard",
				name: "WireGuard Secure Remote Access Gateway",
				tech: "WireGuard, Raspberry Pi, SSH, iptables",
				summary: "Built a self-hosted encrypted tunnel on a Raspberry Pi to secure remote access across untrusted networks. Includes full hardening, firewall rules, and technical documentation.",
			},
		],

		languages: "Japanese: Professional working proficiency",

		certs: [
			{ name: "ISC2 Certified in Cybersecurity (CC)", desc: "Security domains, access control, cryptography, and risk management", status: "Acquired" },
			{ name: "CompTIA Security+", desc: "Core security concepts, threats, architecture, operations", status: "Studying" },
			{ name: "JLPT N2", desc: "Japanese Language Proficiency Test, upper-intermediate", status: "Studying" },
			{ name: "CompTIA CySA+", desc: "Security analytics, threat detection, incident response", status: "Planned" },
		],

		blog: [
			{ date: "Mar 2026", title: "Switching to NVIM", tag: "home-lab", href: "posts/nvim.html" },
		],

		contact: {
			email: "hanselz@usf.edu",
			github: "https://github.com/hanselz-source",
		},
	};

	// =============================================
	//  Command Implementations
	// =============================================
	function cmdHelp() {
		const rows = [
			["help", "Show this help message"],
			["about", "Who I am"],
			["now", "What I'm working on right now"],
			["education", "Education background"],
			["skills", "Technical skills"],
			["leadership", "Leadership experience"],
			["projects", "List project writeups"],
			["open <name>", "Read a project writeup (e.g. open wireguard)"],
			["languages", "Language proficiency"],
			["certs", "Certifications & goals roadmap"],
			["blog", "Notes & write-ups"],
			["contact", "How to reach me"],
			["fetch", "System info (neofetch style)"],
			["theme", "Toggle day/night background"],
			["clear", "Clear the terminal"],
			["history", "Show command history"],
		];
		let html = `<span class="t-green t-bold">Available Commands</span>\n<div class="help-grid">`;
		rows.forEach(([cmd, desc]) => {
			html += `<div class="help-row"><span class="help-cmd">${cmd}</span><span class="help-desc">${desc}</span></div>`;
		});
		html += `</div>\n<span class="t-muted">Tip: Use Tab for autocomplete, Up/Down for history.</span>`;
		return html;
	}

	function cmdAbout() {
		return `<span class="section-header">Hey, I'm Zach.</span>\n${data.about}`;
	}

	function cmdNow() {
		let html = `<span class="section-header">What I'm Up To Right Now</span>\n<span class="t-muted">Updated April 2026</span>\n`;
		data.now.forEach((item) => {
			html += `\n  <span class="t-green">></span> ${item}`;
		});
		return html;
	}

	function cmdEducation() {
		let html = `<span class="section-header">Education</span>`;
		data.education.forEach((ed) => {
			html += `\n<div class="term-row"><span class="t-bright t-bold">${ed.school}</span></div>`;
			html += `<div class="term-row"><span class="t-muted">${ed.date}</span></div>`;
			html += `<div class="term-row"><span class="t-muted">${ed.detail}</span></div>`;
			if (ed.coursework) {
				html += `\n<span class="t-cyan">Relevant Coursework:</span>\n<span class="t-muted">  ${ed.coursework}</span>`;
			}
			html += `\n`;
		});
		return html;
	}

	function cmdSkills() {
		let html = `<span class="section-header">Technical Skills</span>`;
		data.skills.forEach((s) => {
			html += `\n<div class="skill-category"><span class="cat-name">${s.cat}</span>\n<span class="cat-items">${s.items}</span></div>`;
		});
		return html;
	}

	function cmdLeadership() {
		let html = `<span class="section-header">Leadership & Involvement</span>`;
		data.leadership.forEach((l) => {
			html += `\n<span class="t-bright t-bold">${l.title}</span> <span class="t-muted">| ${l.org}</span>`;
			html += `\n<span class="t-muted">${l.date}</span>`;
			l.bullets.forEach((b) => {
				html += `\n  <span class="t-green">-</span> ${b}`;
			});
			html += `\n`;
		});
		return html;
	}

	function cmdProjects() {
		let html = `<span class="section-header">Projects</span>\n<span class="t-muted">Type</span> <span class="t-green">open &lt;name&gt;</span> <span class="t-muted">to read the full writeup.</span>\n`;
		data.projects.forEach((p) => {
			html += `\n<div class="term-project" onclick="document.getElementById('command-input').value='open ${p.id}';document.getElementById('command-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))">
  <div class="proj-name">${p.name}</div>
  <div class="proj-tech">${p.tech}</div>
  <div class="proj-desc">${p.summary}</div>
</div>`;
		});
		return html;
	}

	async function cmdOpen(args) {
		const name = args.trim().toLowerCase();
		const ids = data.projects.map((p) => p.id);
		if (!name) {
			return `<span class="t-red">Usage: open &lt;project-name&gt;</span>\n<span class="t-muted">Available: ${ids.join(", ")}</span>`;
		}
		if (!ids.includes(name)) {
			return `<span class="t-red">Project not found: ${escHtml(name)}</span>\n<span class="t-muted">Available: ${ids.join(", ")}</span>`;
		}
		titleEl.textContent = `visitor@hanselz.dev: ~/projects/${name}`;
		return await fetchWriteup(name);
	}

	function cmdLanguages() {
		return `<span class="section-header">Languages</span>\n<span class="t-cyan">Japanese</span>  Professional working proficiency`;
	}

	function cmdCerts() {
		let html = `<span class="section-header">Certifications & Goals</span>`;
		data.certs.forEach((c) => {
			let dot, tag;
			if (c.status === "Acquired") {
				dot = `<span class="roadmap-dot acquired">&#10004;</span>`;
				tag = `<span class="roadmap-status-tag acquired">${c.status}</span>`;
			} else if (c.status === "Studying") {
				dot = `<span class="roadmap-dot active">&#9654;</span>`;
				tag = `<span class="roadmap-status-tag studying">${c.status}</span>`;
			} else {
				dot = `<span class="roadmap-dot planned">&#9675;</span>`;
				tag = `<span class="roadmap-status-tag planned">${c.status}</span>`;
			}
			html += `\n<div class="term-roadmap-item">${dot}<span class="roadmap-label"><span class="t-bright">${c.name}</span> <span class="t-muted">- ${c.desc}</span></span>${tag}</div>`;
		});
		return html;
	}

	function cmdBlog() {
		let html = `<span class="section-header">Notes & Write-ups</span>\n<span class="t-muted">Occasional posts about things I'm learning, building, or thinking about.</span>\n`;
		data.blog.forEach((b) => {
			html += `\n<div class="term-blog-entry"><span class="blog-entry-date">${b.date}</span><span class="blog-entry-name">${b.title}</span><span class="blog-entry-tag">${b.tag}</span></div>`;
		});
		return html;
	}

	function cmdContact() {
		return `<span class="section-header">Let's Connect</span>
Always happy to talk about security, Japanese, home lab setups,
or anything in between.

  <span class="t-green">email</span>    <a class="term-link" href="mailto:">Send me an email</a>
  <span class="t-green">github</span>   <a class="term-link" href="https:" target="_blank" rel="me">View my GitHub</a>`;
	}

	function cmdFetch() {
		const isNight = document.documentElement.getAttribute("data-time") === "night";
		const now = new Date();
		const uptime = `${now.getHours()}h ${now.getMinutes()}m`;
		const ascii = `    ╔═══════════════╗
    ║  ┌─────────┐  ║
    ║  │ HANSELZ │  ║
    ║  └─────────┘  ║
    ║  ░░░░░░░░░░░  ║
    ╚═══════════════╝`;

		return `<div class="neofetch-box"><pre class="neofetch-ascii">${ascii}</pre><div class="neofetch-info">
<div class="nf-row"><span class="nf-key t-green t-bold">visitor</span><span class="nf-val">@</span><span class="t-green t-bold">hanselz.dev</span></div>
<hr class="nf-separator">
<div class="nf-row"><span class="nf-key">OS</span><span class="nf-val">Zach's Portfolio v2.0</span></div>
<div class="nf-row"><span class="nf-key">Host</span><span class="nf-val">University of South Florida</span></div>
<div class="nf-row"><span class="nf-key">Kernel</span><span class="nf-val">Cybersecurity B.S.</span></div>
<div class="nf-row"><span class="nf-key">Uptime</span><span class="nf-val">${uptime}</span></div>
<div class="nf-row"><span class="nf-key">Shell</span><span class="nf-val">hanselz-term 1.0</span></div>
<div class="nf-row"><span class="nf-key">Theme</span><span class="nf-val">${isNight ? "Night (osaka-dark)" : "Day (osaka-light)"}</span></div>
<div class="nf-row"><span class="nf-key">Terminal</span><span class="nf-val">Web Terminal (JetBrains Mono)</span></div>
<div class="nf-row"><span class="nf-key">Languages</span><span class="nf-val">Python, Bash, SQL, C, JS, Lua, Japanese</span></div>
<div class="nf-row"><span class="nf-key">GPA</span><span class="nf-val">3.54 / 4.00</span></div>
<hr class="nf-separator">
<div class="nf-colors">
  <span class="nf-color-block" style="background:#f87171"></span>
  <span class="nf-color-block" style="background:#fb923c"></span>
  <span class="nf-color-block" style="background:#fbbf24"></span>
  <span class="nf-color-block" style="background:#7cc496"></span>
  <span class="nf-color-block" style="background:#60a5fa"></span>
  <span class="nf-color-block" style="background:#a78bfa"></span>
  <span class="nf-color-block" style="background:#67e8f9"></span>
  <span class="nf-color-block" style="background:#f4f4f5"></span>
</div>
</div></div>`;
	}

	function cmdTheme() {
		const current = document.documentElement.getAttribute("data-time");
		const next = current === "night" ? "day" : "night";
		document.documentElement.setAttribute("data-time", next);
		return `<span class="t-green">Theme switched to ${next} mode.</span>`;
	}

	function cmdClear() {
		output.innerHTML = "";
		titleEl.textContent = "visitor@hanselz.dev: ~";
		return null;
	}

	function cmdHistory() {
		if (state.history.length === 0) {
			return `<span class="t-muted">No commands in history.</span>`;
		}
		let html = "";
		state.history.forEach((cmd, i) => {
			html += `<span class="t-muted">${String(i + 1).padStart(4)}</span>  ${escHtml(cmd)}\n`;
		});
		return html;
	}

	function cmdNotFound(cmd) {
		return `<span class="t-red">Command not found: ${escHtml(cmd)}</span>\n<span class="t-muted">Type</span> <span class="t-green">help</span> <span class="t-muted">for available commands.</span>`;
	}

	// =============================================
	//  Command Router
	// =============================================
	const commandMap = {
		help: cmdHelp,
		about: cmdAbout,
		now: cmdNow,
		education: cmdEducation,
		edu: cmdEducation,
		skills: cmdSkills,
		leadership: cmdLeadership,
		projects: cmdProjects,
		project: (args) => cmdOpen(args),
		open: cmdOpen,
		cat: cmdOpen,
		languages: cmdLanguages,
		lang: cmdLanguages,
		certs: cmdCerts,
		certifications: cmdCerts,
		blog: cmdBlog,
		notes: cmdBlog,
		contact: cmdContact,
		connect: cmdContact,
		fetch: cmdFetch,
		neofetch: cmdFetch,
		theme: cmdTheme,
		clear: cmdClear,
		history: cmdHistory,
		whoami: () => `<span class="t-green">visitor</span>`,
		pwd: () => `<span class="t-text">/home/visitor/hanselz.dev</span>`,
		ls: () => {
			return `<span class="t-blue">about/</span>  <span class="t-blue">education/</span>  <span class="t-blue">skills/</span>  <span class="t-blue">projects/</span>  <span class="t-blue">certs/</span>  <span class="t-blue">blog/</span>\ncontact.txt  languages.txt  now.txt  README.md`;
		},
		date: () => `<span class="t-text">${new Date().toString()}</span>`,
		echo: (args) => escHtml(args),
	};

	const commandNames = Object.keys(commandMap);

	async function executeCommand(raw) {
		const trimmed = raw.trim();
		if (!trimmed) return;

		state.history.push(trimmed);
		state.historyIndex = state.history.length;

		const parts = trimmed.split(/\s+/);
		const cmd = parts[0].toLowerCase();
		const args = parts.slice(1).join(" ");

		const handler = commandMap[cmd];
		let result;
		if (handler) {
			result = typeof handler === "function" ? handler(args) : handler;
			// support async commands (e.g. open)
			if (result && typeof result.then === "function") {
				printCommand(trimmed, `<span class="t-muted">Loading...</span>`);
				try {
					const html = await result;
					// replace the loading message with real content
					const lastBlock = output.lastElementChild;
					if (lastBlock) {
						const resultDiv = lastBlock.querySelector(".cmd-result");
						if (resultDiv) resultDiv.innerHTML = html;
					}
				} catch (e) {
					const lastBlock = output.lastElementChild;
					if (lastBlock) {
						const resultDiv = lastBlock.querySelector(".cmd-result");
						if (resultDiv) resultDiv.innerHTML = `<span class="t-red">Error: ${escHtml(String(e))}</span>`;
					}
				}
				scrollToBottom();
				return;
			}
		} else {
			result = cmdNotFound(cmd);
		}

		if (result !== null && result !== undefined) {
			printCommand(trimmed, result);
		} else {
			if (cmd !== "clear") {
				printCommand(trimmed, "");
			}
		}
	}

	// =============================================
	//  Tab Completion
	// =============================================
	function tabComplete(partial) {
		const lower = partial.toLowerCase();
		const matches = commandNames.filter((c) => c.startsWith(lower));
		if (matches.length === 1) return matches[0];
		if (matches.length > 1) {
			let prefix = matches[0];
			for (let i = 1; i < matches.length; i++) {
				while (!matches[i].startsWith(prefix)) {
					prefix = prefix.slice(0, -1);
				}
			}
			return prefix;
		}
		return partial;
	}

	// =============================================
	//  Input Handler
	// =============================================
	function setupInput() {
		input.addEventListener("keydown", function (e) {
			if (e.key === "Enter") {
				e.preventDefault();
				const val = input.value;
				input.value = "";
				executeCommand(val);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				if (state.historyIndex > 0) {
					state.historyIndex--;
					input.value = state.history[state.historyIndex];
				}
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				if (state.historyIndex < state.history.length - 1) {
					state.historyIndex++;
					input.value = state.history[state.historyIndex];
				} else {
					state.historyIndex = state.history.length;
					input.value = "";
				}
			} else if (e.key === "Tab") {
				e.preventDefault();
				const parts = input.value.split(/\s+/);
				if (parts.length === 1) {
					input.value = tabComplete(parts[0]);
				} else if (parts.length === 2 && (parts[0] === "open" || parts[0] === "project" || parts[0] === "cat")) {
					const projNames = data.projects.map((p) => p.id);
					const partial = parts[1].toLowerCase();
					const matches = projNames.filter((n) => n.startsWith(partial));
					if (matches.length === 1) {
						input.value = parts[0] + " " + matches[0];
					}
				}
			} else if (e.key === "l" && e.ctrlKey) {
				e.preventDefault();
				executeCommand("clear");
			}
		});

		terminal.addEventListener("click", function (e) {
			if (!e.target.closest("a") && !e.target.closest(".term-project")) {
				input.focus();
			}
		});

		document.addEventListener("keydown", function (e) {
			if (!e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement !== input) {
				input.focus();
			}
		});
	}

	// =============================================
	//  Boot Sequence
	// =============================================
	async function boot() {
		const isNight = applyTimeTheme();
		const timeStr = isNight ? "night" : "day";
		const now = new Date();
		const dateStr = now.toLocaleString("en-US", {
			weekday: "short",
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});

		const bootLines = [
			`<span class="boot-line"><span class="boot-label">Connecting to</span> <span class="t-green t-bold">hanselz.dev</span><span class="boot-label">...</span></span>`,
			`<span class="boot-line"><span class="boot-label">Establishing secure connection...</span> <span class="boot-ok">done</span></span>`,
			`<span class="boot-line"><span class="boot-label">Loading scenery:</span> <span class="boot-info">osaka_cityscape (${timeStr})</span></span>`,
			`<span class="boot-line"><span class="boot-label">Last login:</span> <span class="t-muted">${dateStr}</span></span>`,
			``,
			`<span class="t-bright t-bold">Welcome to hanselz.dev</span>`,
			`<span class="t-muted">Cybersecurity student at USF | Japanese Language Study Club President</span>`,
			`<span class="t-muted">Type</span> <span class="t-green">help</span> <span class="t-muted">for available commands.</span>`,
			``,
		];

		await printLines(bootLines, 60);
		state.booted = true;
		input.disabled = false;
		input.focus();
	}

	// =============================================
	//  Init
	// =============================================
	function init() {
		input.disabled = true;
		setupInput();
		boot();
		applyTimeTheme();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}

	// Expose parseMarkdown for project detail pages
	window.__termParseMarkdown = parseMarkdown;
	window.__termEscHtml = escHtml;
})();
