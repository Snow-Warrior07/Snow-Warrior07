import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(root, 'profile.json'), 'utf8'));
const cacheFile = path.join(root, 'data', 'github.json');
const offline = process.argv.includes('--offline');
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function storedToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const result = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }
    });
    return result.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  } catch { return undefined; }
}

async function collect() {
  const token = storedToken();
  const headers = { 'User-Agent': 'Snow-Warrior07-profile', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  async function api(route, body) {
    const response = await fetch(`https://api.github.com/${route}`, {
      headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`GitHub ${route.split('?')[0]} returned ${response.status}`);
    return response.json();
  }
  const [user, repoPages] = await Promise.all([
    api(`users/${config.username}`),
    (async () => {
      const repos = [];
      for (let page = 1; ; page++) {
        const batch = await api(`users/${config.username}/repos?per_page=100&page=${page}`);
        repos.push(...batch);
        if (batch.length < 100) return repos;
      }
    })()
  ]);
  const repos = repoPages.filter(repo => !repo.fork);
  const languages = {};
  await Promise.all(repos.filter(repo => repo.name !== config.username && repo.size > 0).map(async repo => {
    const mix = await api(`repos/${config.username}/${repo.name}/languages`);
    for (const [language, bytes] of Object.entries(mix)) {
      if (language !== 'Jupyter Notebook') languages[language] = (languages[language] || 0) + bytes;
    }
  }));
  let calendar;
  let totalContributions;
  if (token) {
    const result = await api('graphql', {
      query: 'query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}',
      variables: { login: config.username }
    });
    if (result.errors) throw new Error('GitHub contribution query could not be completed.');
    const contributionCalendar = result.data.user.contributionsCollection.contributionCalendar;
    totalContributions = contributionCalendar.totalContributions;
    calendar = contributionCalendar.weeks.flatMap(week => week.contributionDays);
  } else {
    const previous = JSON.parse(await fs.readFile(cacheFile, 'utf8').catch(() => '{}'));
    calendar = previous.calendar || [];
    totalContributions = previous.totalContributions ?? null;
  }
  return {
    username: user.login,
    updated: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    joined: user.created_at.slice(0, 10),
    publicRepos: user.public_repos,
    followers: user.followers,
    stars: repos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
    projects: config.projects.length,
    totalContributions,
    languages,
    calendar,
    repos: repos.map(repo => ({ name: repo.name, created: repo.created_at.slice(0, 10), url: repo.html_url }))
  };
}

const data = offline ? JSON.parse(await fs.readFile(cacheFile, 'utf8')) : await collect();
if (!offline) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(data, null, 2) + '\n');
}

const themes = {
  light: { bg: '#ffffff', fg: '#151515', muted: '#626262', dim: '#999999', line: '#cdcdcd', faint: '#eeeeee', panel: '#f7f7f7' },
  dark: { bg: '#0d1117', fg: '#f0f0f0', muted: '#a1a6ac', dim: '#67707b', line: '#343b44', faint: '#232a33', panel: '#111720' }
};

for (const [theme, c] of Object.entries(themes)) {
  const target = path.join(root, 'assets', theme === 'light' ? '' : 'dark');
  await fs.mkdir(target, { recursive: true });
  const text = (x, y, value, size = 16, fill = c.fg, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(value)}</text>`;
  const mono = (x, y, value, size = 11, fill = c.muted, extra = '') => text(x, y, value, size, fill, `${extra.includes('letter-spacing=') ? '' : 'letter-spacing="2"'} ${extra}`);
  const line = (x1, y1, x2, y2, color = c.line, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" ${extra}/>`;
  const rect = (x, y, w, h, fill = c.panel, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
  const circle = (x, y, r, fill = c.fg, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
  const title = (label, fig) => mono(48, 30, label) + mono(952, 30, fig, 11, c.muted, 'text-anchor="end"');
  const panel = (x, y, w, h) => rect(x, y, w, h, c.bg, `stroke="${c.line}"`);
  async function svg(name, height, content, description, width = 1000) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${esc(name.replace('.svg', ''))}</title><desc id="desc">${esc(description)}</desc><style>text{font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace} .flow{stroke-dasharray:5 9;animation:flow 12s linear infinite} .pulse{animation:pulse 3s ease-in-out infinite} .scan{animation:scan 6s ease-in-out infinite} @keyframes flow{to{stroke-dashoffset:-140}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}} @keyframes scan{0%,100%{transform:translateX(0)}50%{transform:translateX(125px)}} @media(prefers-reduced-motion:reduce){.flow,.pulse,.scan{animation:none}}</style>${rect(0, 0, width, height, c.bg)}${content}</svg>\n`;
    await fs.writeFile(path.join(target, name), source);
  }

  await svg('header.svg', 400,
    title('PORTFOLIO — INDEX Nº 001', 'SNOW-WARRIOR07 / GITHUB') + line(48, 59, 952, 59, c.fg) +
    text(45, 173, config.name, 72, c.fg, 'letter-spacing="-3"') +
    text(48, 214, config.subtitle, 19) + mono(48, 277, 'FOCUS ▸', 11) + text(150, 277, config.focus, 13, c.muted) +
    text(48, 306, 'from models and signals to systems that move.', 14, c.muted) +
    line(48, 352, 952, 352, c.fg) +
    mono(48, 383, 'AUTONOMOUS SYSTEMS', 11) + mono(360, 383, 'HIGH-RESOLUTION VISION', 11) + mono(952, 383, 'BUILD · TEST · ITERATE', 11, c.muted, 'text-anchor="end"'),
    `${config.name}. ${config.subtitle}. ${config.focus}.`);

  for (const [index, label] of ['WHOAMI', 'SYSTEM MAP', 'PROJECTS', 'TELEMETRY', 'THE ROUTE', 'STACK'].entries()) {
    await svg(`s0${index + 1}.svg`, 108,
      text(48, 79, String(index + 1).padStart(2, '0'), 52, c.fg, 'letter-spacing="-3"') +
      mono(130, 67, label, 13, c.fg, 'letter-spacing="4"') + line(350, 62, 825, 62, c.fg) +
      mono(952, 67, `~/0${index + 1}-${label.toLowerCase().replaceAll(' ', '-')}`, 10, c.muted, 'text-anchor="end"'),
      `${String(index + 1).padStart(2, '0')} — ${label.toLowerCase()}`);
  }

  await svg('whoami.svg', 250,
    text(48, 34, 'I build at the intersection of intelligent machines and visual data.', 17) +
    text(48, 66, 'Control loops for autonomous robots. Learning pipelines for large images.', 16) +
    text(48, 100, 'The common thread: understand the model, test the assumptions, inspect the results.', 14, c.muted) +
    line(48, 130, 952, 130) +
    mono(48, 168, 'FOCUS', 11) + text(180, 168, 'Robotics · control engineering · computer vision · representation learning', 14) +
    mono(48, 202, 'BUILDING', 11) + text(180, 202, 'Traction-aware autonomy and efficient high-resolution image pipelines', 14) +
    mono(48, 236, 'APPROACH', 11) + text(180, 236, 'Simulation · reproducible experiments · inspectable engineering', 14),
    'About Abhitesh: robotics, control engineering, computer vision, and representation learning.');

  let ecosystem = title('SYSTEM MAP — ONE ENGINEERING MINDSET', 'FIG. 01');
  ecosystem += panel(335, 70, 330, 95) + mono(500, 107, 'ABHITESH.SYS', 18, c.fg, 'text-anchor="middle"') + text(500, 137, 'model → build → measure', 13, c.muted, 'text-anchor="middle"');
  const centers = [190, 500, 810];
  ecosystem += line(500, 165, 500, 202) + line(190, 202, 810, 202);
  const nodes = [
    ['AUTONOMY', 'traction-aware-amr', 'motion + estimation', 'PI / LQR / nonlinear control', 'ROS 2 + simulation + PCB'],
    ['VISION', 'satellite segmentation', 'pixels + context', 'Residual U-Net + dilations', 'patches + TTA + reconstruction'],
    ['REPRESENTATIONS', 'VAE-Triage', 'compression + quality', 'VQ-VAE + anomaly scoring', 'memory-mapped tiles + ONNX']
  ];
  nodes.forEach((node, i) => {
    const x = centers[i];
    ecosystem += line(x, 202, x, 249, c.fg, 'class="flow"') + circle(x, 202, 4) +
      mono(x, 243, node[0], 11, c.muted, 'text-anchor="middle"') + panel(x - 139, 265, 278, 170) +
      text(x, 303, node[1], 15, c.fg, 'text-anchor="middle"') + text(x, 331, node[2], 13, c.muted, 'text-anchor="middle"') +
      line(x - 119, 352, x + 119, 352) + text(x, 382, node[3], 11, c.fg, 'text-anchor="middle"') + text(x, 408, node[4], 11, c.muted, 'text-anchor="middle"') +
      line(x, 435, x, 475, c.fg, 'class="flow"');
  });
  ecosystem += line(190, 475, 810, 475) + line(500, 475, 500, 506, c.fg, 'class="flow"') +
    panel(250, 506, 500, 61) + mono(500, 543, 'SIMULATE · TRAIN · EVALUATE · REPEAT', 13, c.fg, 'text-anchor="middle"') +
    circle(292, 598, 3, c.fg, 'class="pulse"') + mono(310, 602, 'DASHED LINES — IDEAS IN MOTION', 10);
  await svg('ecosystem.svg', 630, ecosystem, 'Three project tracks connect robotics, satellite vision, and VQ-VAE representation learning through reproducible experimentation.');

  const glyph = (index, x, y) => {
    if (index === 0) return panel(x, y + 19, 80, 53) + circle(x + 13, y + 77, 9, c.bg, `stroke="${c.fg}"`) + circle(x + 67, y + 77, 9, c.bg, `stroke="${c.fg}"`) + line(x + 40, y + 19, x + 40, y) + circle(x + 40, y - 3, 5) + line(x + 16, y + 44, x + 28, y + 44, c.fg) + line(x + 52, y + 44, x + 64, y + 44, c.fg);
    if (index === 1) {
      let result = '';
      for (let r = 0; r < 4; r++) for (let col = 0; col < 4; col++) result += rect(x + col * 22, y + r * 22, 18, 18, (r + col) % 3 === 0 ? c.fg : (r + col) % 3 === 1 ? c.line : c.faint);
      return result;
    }
    return panel(x, y, 90, 82) + line(x + 14, y + 40, x + 39, y + 40, c.fg) + line(x + 51, y + 40, x + 76, y + 40, c.fg) + circle(x + 45, y + 40, 7, c.fg, 'class="pulse"') + line(x + 14, y + 20, x + 31, y + 33, c.muted) + line(x + 14, y + 60, x + 31, y + 47, c.muted) + line(x + 59, y + 33, x + 76, y + 20, c.muted) + line(x + 59, y + 47, x + 76, y + 60, c.muted);
  };
  for (const [i, project] of config.projects.entries()) {
    let body = mono(48, 28, `${String(i + 1).padStart(2, '0')} / ${project.category}`, 10) +
      text(48, 70, project.title, 26, c.fg, 'letter-spacing="-.5"') + mono(946, 31, 'VIEW REPOSITORY ↗', 10, c.muted, 'text-anchor="end"');
    project.summary.forEach((copy, j) => { body += text(48, 110 + j * 25, copy, 15, j === 0 ? c.fg : c.muted); });
    body += glyph(i, 834, 93) + text(48, 201, project.detail, 12, c.muted) + mono(48, 235, project.stack, 10) + line(48, 261, 952, 261);
    await svg(`project-0${i + 1}.svg`, 282, body, `${project.title}. ${project.summary.join(' ')} ${project.stack}.`);
  }

  let telemetry = title('TELEMETRY — THE ENGINEERING LOOP', 'FIG. 02');
  const steps = ['MODEL', 'BUILD', 'TEST', 'INSPECT'];
  steps.forEach((step, i) => {
    const x = 48 + i * 232;
    telemetry += panel(x, 74, 208, 82) + mono(x + 18, 103, `0${i + 1}`, 10) + text(x + 18, 135, step, 19);
    if (i < 3) telemetry += line(x + 208, 114, x + 232, 114, c.fg, 'class="flow"');
  });
  telemetry += line(48, 190, 952, 190) +
    mono(48, 221, 'CURRENT FOCUS', 11) + text(48, 255, 'Traction-aware control', 18) + text(48, 284, 'and high-resolution learning.', 18) +
    mono(566, 221, 'FEEDBACK, ALWAYS', 11) +
    `<path d="M566 263 H620 L641 245 L660 278 L688 231 L712 285 L734 254 H765 L787 270 L811 242 L835 273 H952" fill="none" stroke="${c.fg}" stroke-width="2"/>` +
    circle(845, 273, 4, c.fg, 'class="pulse"') + rect(700, 233, 1, 57, c.line, 'class="scan"');
  await svg('telemetry.svg', 330, telemetry, 'Animated engineering loop: model, build, test, and inspect. The waveform is decorative, not a measurement.');

  let stats = title('GITHUB — PUBLIC SIGNALS', `UPDATED ${data.updated}`);
  const metrics = [[data.publicRepos, 'PUBLIC REPOS'], [data.projects, 'FEATURED PROJECTS'], [data.totalContributions ?? '—', 'CONTRIBUTIONS / YEAR'], [data.stars, 'REPO STARS']];
  metrics.forEach(([value, label], i) => {
    const x = 48 + i * 232;
    stats += text(x, 111, String(value).padStart(2, '0'), 52, c.fg, 'letter-spacing="-3"') + mono(x, 143, label, 10);
  });
  stats += line(48, 175, 952, 175) + mono(48, 206, 'SOURCE LANGUAGE MIX · NOTEBOOKS EXCLUDED', 10);
  const langs = Object.entries(data.languages).sort((a, b) => b[1] - a[1]);
  const sum = langs.reduce((total, [, value]) => total + value, 0);
  const shown = langs.slice(0, 4);
  if (langs.length > 4) shown.push(['Other', langs.slice(4).reduce((total, [, value]) => total + value, 0)]);
  const shades = theme === 'dark' ? ['#eeeeee', '#b8b8b8', '#878787', '#565656', '#393939'] : ['#161616', '#555555', '#888888', '#bbbbbb', '#dddddd'];
  let offset = 48;
  shown.forEach(([lang, value], i) => {
    const width = 904 * value / sum;
    stats += rect(offset, 231, Math.max(0, width - 3), 14, shades[i]);
    offset += width;
    const x = 48 + i * (904 / shown.length);
    stats += rect(x, 267, 8, 8, shades[i]) + text(x + 18, 275, `${lang} ${(100 * value / sum).toFixed(1)}%`, 12, c.muted);
  });
  stats += text(48, 314, `@${data.username} · public GitHub activity · refreshed daily`, 11, c.muted);
  await svg('github-stats.svg', 342, stats, `${data.publicRepos} public repositories, ${data.projects} featured projects, ${data.totalContributions ?? 'unavailable'} contributions in the past year, ${data.stars} repository stars. Source languages are aggregated across public original repositories excluding this profile and Jupyter notebooks.`);

  let contributions = title('CONTRIBUTION TELEMETRY — LAST 90 DAYS', 'FIG. 03');
  const cutoff = new Date(`${data.updated}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 89);
  const recent = data.calendar.filter(day => day.date >= cutoff.toISOString().slice(0, 10) && day.date <= data.updated);
  const totalRecent = recent.reduce((sum, day) => sum + day.contributionCount, 0);
  const maxCount = Math.max(1, ...recent.map(day => day.contributionCount));
  contributions += text(48, 72, `${totalRecent} contributions`, 20) + text(952, 72, 'A small beginning. A steady direction.', 12, c.muted, 'text-anchor="end"');
  contributions += line(48, 100, 952, 100) + line(48, 220, 952, 220);
  for (let i = 1; i < 4; i++) contributions += line(48, 100 + i * 30, 952, 100 + i * 30, c.faint);
  const pts = recent.map((day, i) => [48 + i * 904 / Math.max(1, recent.length - 1), 220 - day.contributionCount / maxCount * 108]);
  if (pts.length) {
    const coordinates = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    contributions += `<polygon points="48,220 ${coordinates} 952,220" fill="${c.fg}" opacity=".045"/><polyline points="${coordinates}" fill="none" stroke="${c.fg}" stroke-width="2"/>`;
    recent.forEach((day, i) => { if (day.contributionCount) contributions += circle(pts[i][0].toFixed(2), pts[i][1].toFixed(2), 3); });
    contributions += text(48, 249, recent[0].date, 11, c.muted) + text(952, 249, recent.at(-1).date, 11, c.muted, 'text-anchor="end"');
  } else contributions += text(500, 160, 'Activity data will refresh when GitHub is available.', 14, c.muted, 'text-anchor="middle"');
  contributions += text(48, 289, 'Every visible point is a day in the GitHub contribution calendar.', 11, c.muted);
  await svg('activity.svg', 315, contributions, `Actual GitHub daily contribution counts from the past 90 days, totaling ${totalRecent} contributions. Updated ${data.updated}.`);

  let timeline = title('THE ROUTE SO FAR — REPOSITORY MILESTONES', 'FIG. 04');
  const milestones = [
    ['FEB 2025', 'GitHub begins', 'First step into the open.'],
    ['MAY 2026', 'Project scaffolds', 'Stocks + inventory.'],
    ['SEP 2026', 'Vision pipelines', 'Satellite tiles + VQ-VAE.'],
    ['OCT 2026', 'Autonomous systems', 'Traction-aware rover.']
  ];
  timeline += line(100, 105, 880, 105, c.fg, 'class="flow"');
  milestones.forEach(([date, label, detail], i) => {
    const x = 100 + i * 260;
    timeline += mono(x, 80, date, 11, c.fg, 'text-anchor="middle"') + circle(x, 105, 5, c.bg, `stroke="${c.fg}" stroke-width="2" ${i === 3 ? 'class="pulse"' : ''}`) +
      text(x, 145, label, 14, c.fg, 'text-anchor="middle"') + text(x, 174, detail, 11, c.muted, 'text-anchor="middle"');
  });
  timeline += text(48, 216, 'From early repositories to learning pipelines and virtual machines.', 12, c.muted);
  await svg('timeline.svg', 246, timeline, 'GitHub account created February 2025. Stock and inventory repositories created May 2026. Vision repositories created September 2026. Robotics repository created October 2026.');

  let approach = title('HOW I BUILD', 'MODEL → EVIDENCE');
  const practices = [
    ['CONTROL', 'Start with the dynamics.', 'Simulate contact and sensors; compare controller variants under matched conditions.'],
    ['VISION', 'Respect the scale of the data.', 'Tile large images; build multiscale features; reconstruct full-resolution predictions.'],
    ['LEARNING', 'Make the pipeline inspectable.', 'Train representations; examine reconstruction errors; export models for inference.']
  ];
  practices.forEach(([label, heading, copy], i) => {
    const y = 86 + i * 100;
    approach += mono(48, y, label, 11, c.fg) + text(196, y, heading, 17) + text(196, y + 29, copy, 13, c.muted);
    if (i < 2) approach += line(48, y + 56, 952, y + 56);
  });
  await svg('approach.svg', 345, approach, 'Project-based engineering approach: model the dynamics, respect image scale, and inspect the learning pipeline.');

  const stackRows = [
    ['LANGUAGES', 'Python · C++'],
    ['LEARNING', 'PyTorch · TensorFlow · Keras · VQ-VAE · residual U-Net'],
    ['ROBOTICS', 'ROS 2 · Gazebo · PI / LQR · nonlinear tracking'],
    ['HARDWARE', 'KiCad · ngspice · Raspberry Pi Pico carrier design'],
    ['COMPUTE', 'NumPy · memory-mapped tiling · ONNX · Jupyter'],
    ['TOOLING', 'Git · GitHub Actions · pytest · reproducible experiments']
  ];
  let stack = '';
  stackRows.forEach(([label, value], i) => {
    const y = 34 + i * 44;
    stack += mono(48, y, label, 11) + text(195, y, value, 15);
    if (i < stackRows.length - 1) stack += line(48, y + 19, 952, y + 19, c.faint);
  });
  await svg('stack.svg', 295, stack, 'Technologies evidenced in the three featured repositories: Python, C++, PyTorch, TensorFlow, Keras, ROS 2, Gazebo, KiCad, ngspice, NumPy, ONNX, Jupyter, GitHub Actions, and pytest.');

  await svg('footer.svg', 165,
    line(48, 34, 952, 34, c.fg) + circle(55, 80, 4, c.fg, 'class="pulse"') + mono(74, 84, 'STATUS — BUILDING, TESTING, ITERATING', 11, c.fg) +
    text(48, 118, 'Models become useful when they meet the world.', 14, c.muted) + mono(952, 118, '@SNOW-WARRIOR07', 10, c.muted, 'text-anchor="end"') +
    mono(48, 151, 'ROBOTICS / CONTROL / VISION', 9, c.dim) + mono(952, 151, 'END OF FILE ↗', 9, c.dim, 'text-anchor="end"'),
    'Status: building, testing, iterating. Abhitesh Shukla, Snow-Warrior07.');

  for (const link of config.links) {
    const label = link.label.toLowerCase().replace(/[^a-z0-9-]/g, '');
    await svg(`link-${label}.svg`, 40, text(60, 26, link.label, 13, c.fg, 'text-anchor="middle" letter-spacing="1"'), link.label, 120);
  }
}

function picture(name, alt, width = '100%') {
  return `<picture><source media="(prefers-color-scheme: dark)" srcset="assets/dark/${name}.svg"><img src="assets/${name}.svg" width="${width}" alt="${esc(alt)}"></picture>`;
}
const navigation = config.links.map(link => `<a href="${esc(link.url)}">${picture(`link-${link.label.toLowerCase().replace(/[^a-z0-9-]/g, '')}`, link.label, '105')}</a>`).join('\n  ');
const readme = `<!-- Generated from profile.json and verified public GitHub data. -->
<div align="center">
  ${picture('header', `${config.name} — ${config.subtitle}`)}
  ${navigation}
</div>

${picture('s01', '01 — whoami')}
${picture('whoami', 'About Abhitesh: robotics, control systems, computer vision, and representation learning')}

${picture('s02', '02 — system map')}
${picture('ecosystem', 'Project ecosystem: autonomous systems, satellite vision, and VQ-VAE representations')}

${picture('s03', '03 — projects')}
${config.projects.map((project, i) => `<a href="${project.url}">${picture(`project-0${i + 1}`, `${project.title}: ${project.summary.join(' ')}`)}</a>`).join('\n\n')}
<p align="center"><a href="https://github.com/${config.username}?tab=repositories">Explore all repositories ↗</a></p>

${picture('s04', '04 — telemetry')}
${picture('telemetry', 'Animated engineering loop: model, build, test, inspect')}
${picture('github-stats', 'GitHub statistics and source language distribution, refreshed daily')}
${picture('activity', 'Actual GitHub contribution activity over the past 90 days')}

${picture('s05', '05 — the route')}
${picture('timeline', 'Repository milestones from February 2025 to October 2026')}
${picture('approach', 'Engineering approach: model dynamics, tile large images, inspect learning pipelines')}

${picture('s06', '06 — stack')}
${picture('stack', 'Technical stack used in the featured repositories')}
${picture('footer', 'Current status: building, testing, iterating')}

<details>
<summary>Text version · project index</summary>

**${config.name}** — ${config.subtitle}.

I build autonomous-system simulations and learning pipelines for high-resolution imagery.

${config.projects.map(project => `- [${project.title}](${project.url}) — ${project.summary.join(' ')}\n  ${project.stack}`).join('\n')}

The timeline records public repository milestones. Statistics refresh daily from GitHub. Animated graphics respect reduced-motion preferences.

Visual direction inspired by [Sharann Manojkumar's profile](https://github.com/Sharann-del); graphics and content created for this profile.

</details>
`;
await fs.writeFile(path.join(root, 'README.md'), readme);

// Local-only HTML previews use the same images and theme switches as the README.
for (const theme of ['light', 'dark']) {
  const preview = readme.replaceAll(/<source[^>]+>/g, '').replaceAll('width="105"', 'width="105"').replaceAll('src="assets/', `src="assets/${theme === 'dark' ? 'dark/' : ''}`);
  const bg = theme === 'dark' ? '#0d1117' : '#ffffff';
  const color = theme === 'dark' ? '#c9d1d9' : '#24292f';
  await fs.writeFile(path.join(root, `preview-${theme}.html`), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(config.name)} · GitHub profile · ${theme}</title><style>body{margin:0;background:${bg};color:${color};font:14px system-ui}main{max-width:940px;margin:32px auto;border:1px solid ${theme === 'dark' ? '#30363d' : '#d0d7de'};border-radius:6px;padding:24px}header{font:12px monospace;margin-bottom:24px}img{max-width:100%;height:auto;vertical-align:middle}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}details{padding:16px 24px}picture{display:inline}summary{cursor:pointer}@media(max-width:700px){main{padding:10px;margin:12px;border-radius:4px}}</style></head><body><main><header>${esc(config.username)} / README.md</header>${preview}</main></body></html>`);
}
console.log(`Generated profile graphics in both themes from public data dated ${data.updated}.`);
