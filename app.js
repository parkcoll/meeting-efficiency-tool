'use strict';

// ──────────────────────────────────────────────────────────────
// BENCHMARK DATA  (from Worklytics Advanced Benchmarks v2025.2)
// ──────────────────────────────────────────────────────────────
const BM = {
  ic: {
    label: 'Individual Contributor',
    hrs:  { p25: 4.3,  p50: 7.4,  p75: 11.2, p90: 15.2 },
  },
  manager: {
    label: 'Frontline Manager',
    hrs:  { p25: 9.5,  p50: 14.1, p75: 18.9, p90: 23.4 },
  },
  senior_leader: {
    label: 'Senior Leader',
    hrs:  { p25: 12.8, p50: 18.2, p75: 23.7, p90: 28.7 },
  },
};

const ROLE_LABELS = {
  ic: 'Individual Contributor',
  manager: 'Manager',
  senior_leader: 'Senior Leader',
};

const AVATAR_COLORS = [
  '#3960f0','#10b981','#f59e0b','#8b5cf6',
  '#ec4899','#06b6d4','#f97316','#84cc16',
];

// ──────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────
const S = {
  formData:    null,
  result:      null,
  teamEntries: [],   // decoded from URL ?t=
  shareLink:   '',
};

// ──────────────────────────────────────────────────────────────
// SCREEN NAVIGATION
// ──────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById('s-' + id).classList.add('active');
  // When embedded (e.g. Webflow), scroll to the tool container rather than
  // the page top — otherwise the user gets scrolled above the embed.
  const host = document.getElementById('wl-meeting-score');
  if (host) {
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ──────────────────────────────────────────────────────────────
// FORM PROGRESS
// ──────────────────────────────────────────────────────────────
function setStep(n) {
  document.getElementById('step-1').style.display = n === 1 ? '' : 'none';
  document.getElementById('step-2').style.display = n === 2 ? '' : 'none';

  const labels = ['', 'About you', 'Meeting habits'];
  document.getElementById('prog-meta').textContent = `Step ${n} of 2 · ${labels[n]}`;

  // Dots
  ['pd1','pd2','pd3'].forEach((id, i) => {
    const el = document.getElementById(id);
    el.className = 'prog-dot' + (i + 1 < n ? ' done' : i + 1 === n ? ' active' : '');
  });
  // Lines
  ['pl1','pl2'].forEach((id, i) => {
    document.getElementById(id).className = 'prog-line' + (i + 1 < n ? ' done' : '');
  });
}

function startTool() { showScreen('form'); setStep(1); }

function goStep2() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { document.getElementById('f-name').focus(); return; }
  setStep(2);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goStep1() { setStep(1); }
function resetToForm() { showScreen('form'); setStep(1); }

// Slider value helper
function sv(id, val) { document.getElementById(id).textContent = val; }

// ──────────────────────────────────────────────────────────────
// TEAM URL ENCODING
// ──────────────────────────────────────────────────────────────
function encodeTeam(entries) {
  try {
    // compact: [name, role, score, meetingHrsWeek, focusHrsDay, annualCost]
    const c = entries.map(e =>
      [e.name, e.role, e.score,
       +e.meetingHrsWeek.toFixed(1),
       +e.focusHrsDay.toFixed(1),
       e.annualCost]);
    return btoa(unescape(encodeURIComponent(JSON.stringify(c))));
  } catch { return ''; }
}

function decodeTeam(encoded) {
  try {
    const c = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    return c.map(([name, role, score, meetingHrsWeek, focusHrsDay, annualCost]) =>
      ({ name, role, score, meetingHrsWeek, focusHrsDay, annualCost }));
  } catch { return []; }
}

// ──────────────────────────────────────────────────────────────
// SCORING
// ──────────────────────────────────────────────────────────────
function computeScore(data) {
  const meetingHrsWeek = (data.meetingsPerWeek * data.avgDuration) / 60;
  const b = BM[data.role].hrs;

  // 1. Meeting Load (40%) — lower hrs vs benchmark = better
  let loadScore;
  if      (meetingHrsWeek <= b.p25) loadScore = 100;
  else if (meetingHrsWeek <= b.p50) loadScore = 100 - 50 * (meetingHrsWeek - b.p25) / (b.p50 - b.p25);
  else if (meetingHrsWeek <= b.p75) loadScore = 50  - 30 * (meetingHrsWeek - b.p50) / (b.p75 - b.p50);
  else                              loadScore = Math.max(0, 20 - 20 * (meetingHrsWeek - b.p75) / (b.p90 - b.p75));

  // 2. Meeting Size (20%) — fewer attendees = better
  const a = data.avgAttendees;
  let sizeScore;
  if      (a <= 2)  sizeScore = 100;
  else if (a <= 5)  sizeScore = 100 - 25 * (a - 2) / 3;
  else if (a <= 10) sizeScore = 75  - 45 * (a - 5) / 5;
  else if (a <= 20) sizeScore = 30  - 20 * (a - 10) / 10;
  else              sizeScore = 10;

  // 3. Recurrence (20%) — sweet spot ~30-55%
  const r = data.pctRecurring;
  let recurScore;
  if      (r < 20)  recurScore = 60;
  else if (r <= 55) recurScore = 60 + 40 * (r - 20) / 35;
  else if (r <= 72) recurScore = 100 - 50 * (r - 55) / 17;
  else              recurScore = Math.max(20, 50 - 30 * (r - 72) / 28);

  // 4. Focus Time (20%) — based on avg uninterrupted gap between meetings
  //    Focus time = 2h+ contiguous blocks. More/longer meetings = smaller gaps.
  const meetingHrsDay  = meetingHrsWeek / 5;
  const meetingsPerDay = data.meetingsPerWeek / 5;
  const freeMinsPerDay = Math.max(0, 480 - meetingsPerDay * data.avgDuration);
  // Average gap between meetings (including before first and after last)
  const avgGapMins     = meetingsPerDay > 0 ? freeMinsPerDay / (meetingsPerDay + 1) : 480;
  const focusHrsDay    = avgGapMins / 60; // avg uninterrupted block, in hours
  let focusScore;
  if      (avgGapMins >= 180) focusScore = 100;  // 3h+ blocks: excellent
  else if (avgGapMins >= 120) focusScore = 80;   // 2h blocks: solid
  else if (avgGapMins >= 90)  focusScore = 55;   // 1.5h: limited
  else if (avgGapMins >= 60)  focusScore = 30;   // 1h: poor
  else                        focusScore = 10;   // <1h: severely fragmented

  // 5. Calendar Fragmentation (15%) — how chopped up is the workday?
  //    Separate from focus: measures interruption density, not just block size.
  let fragmentScore;
  if      (meetingsPerDay <= 1)  fragmentScore = 100;
  else if (meetingsPerDay <= 2)  fragmentScore = 82;
  else if (meetingsPerDay <= 3)  fragmentScore = 62;
  else if (meetingsPerDay <= 5)  fragmentScore = 38;
  else if (meetingsPerDay <= 7)  fragmentScore = 18;
  else                           fragmentScore = 5;

  const total = Math.min(100, Math.max(0, Math.round(
    loadScore    * 0.35 +
    sizeScore    * 0.15 +
    recurScore   * 0.15 +
    focusScore   * 0.20 +
    fragmentScore * 0.15
  )));

  return {
    total,
    loadScore:     Math.round(Math.max(0, loadScore)),
    sizeScore:     Math.round(Math.max(0, sizeScore)),
    recurScore:    Math.round(Math.max(0, recurScore)),
    focusScore:    Math.round(Math.max(0, focusScore)),
    fragmentScore: Math.round(Math.max(0, fragmentScore)),
    meetingHrsWeek,
    meetingHrsDay,
    meetingsPerDay,
    avgGapMins,
    focusHrsDay,
    freeMinsPerDay,
    annualCost:  Math.round(meetingHrsWeek * 48 * data.hourlyRate),
    bench:       b,
  };
}

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s >= 75) return '#10b981';
  if (s >= 55) return '#f59e0b';
  if (s >= 35) return '#f97316';
  return '#ef4444';
}

// ──────────────────────────────────────────────────────────────
// ANIMAL ARCHETYPE  (pct = meeting-hour percentile, 0=fewest, 100=most)
// ──────────────────────────────────────────────────────────────
const ANIMALS = [
  { max: 2,  name: 'Hermit Hedgehog',   file: 'hermit-hedgehog.png',   desc: 'Meetings? What meetings? You\'ve achieved what most only dream about.' },
  { max: 7,  name: 'Solo Salamander',   file: 'solo-salamander.png',   desc: 'Thrives in silence. Your calendar is practically empty — intentionally.' },
  { max: 16, name: 'Flow State Fox',    file: 'flow-state-fox.png',    desc: 'In the zone. DND is your natural habitat. People wonder where you are.' },
  { max: 26, name: 'Deep Work Deer',    file: 'deep-work-deer.png',    desc: 'Gracefully elusive to most meeting organizers. Your focus time shows it.' },
  { max: 37, name: 'Focused Ferret',    file: 'focused-ferret.png',    desc: 'Quick and purposeful. You pick your meetings wisely and guard your time.' },
  { max: 52, name: 'Balanced Buffalo',  file: 'balanced-buffalo.png',  desc: 'Right in the middle of the herd. A reasonable amount of meetings — well done.' },
  { max: 63, name: 'Agenda Alpaca',     file: 'agenda-alpaca.png',     desc: 'Mysteriously on every invite. Nobody knows how. Not even you.' },
  { max: 75, name: 'Recurring Raccoon', file: 'recurring-raccoon.png', desc: 'Same meeting, every Tuesday. You know the one. You always will.' },
  { max: 85, name: 'Scheduled Sardine', file: 'scheduled-sardine.png', desc: 'Packed in tight with no room to breathe. Your calendar is a tin can.' },
  { max: 95, name: 'Overloaded Otter',  file: 'overloaded-otter.png',  desc: 'Paddling furiously just to stay afloat. Time to start declining some invites.' },
  { max: 101,name: 'Meeting Martyr',    file: 'meeting-martyr.png',    desc: 'You\'ve sacrificed your calendar to the meeting gods. Heroic. Unsustainable.' },
];

function getAnimal(pct) {
  // pct: normalCDF percentile of meeting hours (0 = fewest, 100 = most)
  for (const a of ANIMALS) {
    if (pct < a.max) return a;
  }
  return ANIMALS[ANIMALS.length - 1];
}

function scoreGrade(s) {
  if (s >= 80) return { label: 'Well Calibrated',   headline: 'Your meeting habits look healthy',           cls: 'good'   };
  if (s >= 65) return { label: 'Manageable',         headline: 'Some room to tighten up',                    cls: 'warn'   };
  if (s >= 45) return { label: 'Overloaded',         headline: 'Meetings are eating into your day',          cls: 'orange' };
  return             { label: 'Meeting-Heavy',       headline: 'Significant impact on your productivity',    cls: 'danger' };
}

function fmtHrs(h) { return h.toFixed(1) + 'h'; }

function fmtMoney(n) {
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return '$' + Math.round(n / 1000) + 'K';
  return '$' + n.toLocaleString();
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ──────────────────────────────────────────────────────────────
// INSIGHTS
// ──────────────────────────────────────────────────────────────
function buildInsights(data, result) {
  const ins = [];
  const b   = result.bench;
  const rl  = ROLE_LABELS[data.role];
  const hrs = result.meetingHrsWeek.toFixed(1);
  const fhr = result.focusHrsDay.toFixed(1);
  const focusLabel = { ic: 'flow time', manager: 'focus time', senior_leader: 'prep time' }[data.role];
  const minFocus = { ic: 2, manager: 1, senior_leader: 0.5 }[data.role];

  // 1. Meeting load
  if (result.meetingHrsWeek > b.p75) {
    ins.push({ icon: '🔴', type: 'red',
      title: 'High meeting load',
      text: `You spend ${hrs}h/week in meetings — above the 75th percentile for ${rl}s (benchmark: ${b.p75}h). That's ${(result.meetingHrsWeek - b.p50).toFixed(1)}h more than the median. Start by auditing recurring meetings: cancel, shorten, or make async where possible.`,
    });
  } else if (result.meetingHrsWeek > b.p50) {
    ins.push({ icon: '🟡', type: 'amber',
      title: 'Slightly above median',
      text: `At ${hrs}h/week, you're above the ${rl} benchmark median of ${b.p50}h. There's likely room to reclaim an hour or two — especially by shortening meetings from 60 to 45 minutes or shifting some to async.`,
    });
  } else {
    ins.push({ icon: '✅', type: 'green',
      title: 'Meeting load looks healthy',
      text: `At ${hrs}h/week, you're at or below the ${rl} benchmark median of ${b.p50}h. That's a good sign — you're protecting time for focused work. Keep an eye on meeting creep as your role evolves.`,
    });
  }

  // 2. Focus time
  if (result.focusHrsDay < minFocus) {
    ins.push({ icon: '⚠️', type: 'amber',
      title: `Insufficient ${focusLabel}`,
      text: `You have only ~${fhr}h of uninterrupted time per day — below the recommended ${minFocus}h minimum for a ${rl}. Try "calendar bookending": cluster meetings at the start or end of your day to create longer free blocks without canceling anything.`,
    });
  } else if (result.focusHrsDay < minFocus * 2) {
    ins.push({ icon: '🟡', type: 'amber',
      title: `Limited ${focusLabel}`,
      text: `You have roughly ${fhr}h of uninterrupted time per day — enough to get something done, but tight. Protecting even one additional hour could meaningfully improve your output quality.`,
    });
  } else {
    ins.push({ icon: '✅', type: 'green',
      title: `Good ${focusLabel}`,
      text: `With ~${fhr}h of uninterrupted time per day, you have solid space for deep work. Protect those blocks actively — they're one of the most valuable things on your calendar.`,
    });
  }

  // 3. Meeting size
  if (data.avgAttendees >= 10) {
    ins.push({ icon: '👥', type: 'red',
      title: 'Large meetings dominate your calendar',
      text: `An average of ${data.avgAttendees} people per meeting is high. Large meetings are often associated with diffused accountability and lower engagement. Ask: who truly needs to be in the room vs. who just needs a summary afterward?`,
    });
  } else if (data.avgAttendees >= 7) {
    ins.push({ icon: '👥', type: 'blue',
      title: 'Meeting sizes could be leaner',
      text: `Averaging ${data.avgAttendees} attendees per meeting leaves room to be more selective. Research shows decision quality tends to improve with smaller, focused groups. Consider a "mandatory vs. optional" attendee policy.`,
    });
  }

  // 4. Recurrence
  if (data.pctRecurring > 70) {
    ins.push({ icon: '🔁', type: 'amber',
      title: 'High recurring meeting load',
      text: `${data.pctRecurring}% of your meetings are recurring — above the typical healthy range of 30–55%. Recurring meetings are efficient when they serve a real need, but tend to outlive their usefulness. Schedule a quarterly "recurring audit."`,
    });
  } else if (data.pctRecurring < 20) {
    ins.push({ icon: '🔁', type: 'blue',
      title: 'Few recurring meetings',
      text: `Only ${data.pctRecurring}% of your meetings are recurring. While that keeps flexibility, very ad-hoc scheduling patterns can make collaboration harder to predict and plan around for your teammates.`,
    });
  }

  // 5. Cost (always)
  const costStr = fmtMoney(result.annualCost);
  const saving10 = fmtMoney(Math.round(result.annualCost * 0.10));
  ins.push({ icon: '💰', type: 'blue',
    title: `${costStr}/year in meeting time`,
    text: `Your time only: ${hrs}h/week × 48 weeks × $${data.hourlyRate}/hr. This is the salary cost of your meeting hours — not counting other attendees. A 10% reduction in meeting load would reclaim roughly ${saving10}/year of productive time.`,
  });

  return ins.slice(0, 4);
}

// ──────────────────────────────────────────────────────────────
// BELL CURVE CHART (canvas)
// ──────────────────────────────────────────────────────────────
function gaussPDF(x, mu, sigma) {
  return Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
}

function normalCDF(x, mu, sigma) {
  const z = (x - mu) / (sigma * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const e = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 +
            t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
  return 0.5 * (1 + (z >= 0 ? 1 : -1) * e);
}

function iqrSigma(p25, p75) { return (p75 - p25) / (2 * 0.6745); }

function ordinal(n) {
  if (n >= 11 && n <= 13) return n + 'th';
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}

function drawBellChart(canvas, myHrs, bench) {
  const mu    = bench.p50;
  const sigma = iqrSigma(bench.p25, bench.p75);
  const xMax  = Math.ceil((mu + 3.2 * sigma) / 5) * 5;
  const N     = 220;
  const xs    = Array.from({ length: N }, (_, i) => (i / (N - 1)) * xMax);
  const ys    = xs.map(x => gaussPDF(x, mu, sigma));
  const maxY  = Math.max(...ys);

  const pct  = Math.round(normalCDF(myHrs, mu, sigma) * 100);
  const clr  = scoreColor(100 - Math.min(pct, 100)); // high percentile = bad score

  // Canvas setup
  const W = canvas.offsetWidth || 300;
  const H = canvas.height;
  canvas.width = Math.round(W * (window.devicePixelRatio || 1));
  canvas.height = Math.round(H * (window.devicePixelRatio || 1));
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  const mL = 32, mR = 12, mT = 22, mB = 26;
  const cW = W - mL - mR;
  const cH = H - mT - mB;
  const baseY = mT + cH;

  const sx = v => mL + (v / xMax) * cW;
  const sy = y => mT + cH - (y / maxY) * cH * 0.86;

  ctx.clearRect(0, 0, W, H);

  // Fill + stroke curve
  ctx.beginPath();
  ctx.moveTo(sx(0), baseY);
  xs.forEach((x, i) => ctx.lineTo(sx(x), sy(ys[i])));
  ctx.lineTo(sx(xMax), baseY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(57,96,240,0.08)';
  ctx.fill();

  ctx.beginPath();
  xs.forEach((x, i) => i === 0 ? ctx.moveTo(sx(x), sy(ys[i])) : ctx.lineTo(sx(x), sy(ys[i])));
  ctx.strokeStyle = 'rgba(57,96,240,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Baseline
  ctx.beginPath(); ctx.moveTo(mL, baseY); ctx.lineTo(mL + cW, baseY);
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.stroke();

  // X-axis ticks
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 5; i++) {
    const v = (i / 5) * xMax;
    ctx.fillText(Math.round(v) + 'h', sx(v), baseY + 16);
  }

  // Median dashed line
  const mx = sx(mu);
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(mx, mT - 2); ctx.lineTo(mx, baseY);
  ctx.strokeStyle = 'rgba(100,116,139,0.45)'; ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('median', mx, mT - 4);

  // Shaded area under "you"
  const myX = Math.max(0, Math.min(myHrs, xMax));
  const youX = sx(myX);
  ctx.beginPath();
  ctx.moveTo(sx(0), baseY);
  for (let i = 0; i < xs.length && xs[i] <= myX; i++) ctx.lineTo(sx(xs[i]), sy(ys[i]));
  ctx.lineTo(youX, baseY);
  ctx.closePath();
  ctx.fillStyle = clr + '28';
  ctx.fill();

  // "You" vertical line + dot
  const closestIdx = xs.reduce((b, x, i) => Math.abs(x - myX) < Math.abs(xs[b] - myX) ? i : b, 0);
  const dotY = sy(ys[closestIdx]);

  ctx.beginPath(); ctx.moveTo(youX, dotY); ctx.lineTo(youX, baseY);
  ctx.strokeStyle = clr; ctx.lineWidth = 2; ctx.stroke();

  ctx.beginPath(); ctx.arc(youX, dotY, 5, 0, Math.PI * 2);
  ctx.fillStyle = clr; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

  // "you (Xth)" label — place left of dot when user is left of median,
  // right of dot when user is right of median, to avoid overlapping the curve
  const goRight = youX >= mx;
  ctx.fillStyle = clr;
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = goRight ? 'left' : 'right';
  const effPct = Math.max(1, Math.min(99, 100 - pct));
  const label  = effPct <= 50
    ? `you (bottom ${effPct}%)`
    : `you (top ${100 - effPct}%)`;
  ctx.fillText(label, goRight ? youX + 9 : youX - 9, dotY - 8);
}

// ──────────────────────────────────────────────────────────────
// GAUGE ANIMATION
// ──────────────────────────────────────────────────────────────
function animateGauge(score) {
  const arc   = document.getElementById('gauge-arc');
  const numEl = document.getElementById('r-score-num');
  const clr   = scoreColor(score);
  const total = 329.87; // full 270° arc at r=70

  arc.style.stroke = clr;
  setTimeout(() => {
    arc.style.strokeDashoffset = total * (1 - score / 100);
  }, 80);

  // Count-up
  const dur = 1200;
  const t0  = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    numEl.textContent = Math.round(e * score);
    if (p < 1) requestAnimationFrame(tick);
    else numEl.textContent = score;
  }
  requestAnimationFrame(tick);
}

// ──────────────────────────────────────────────────────────────
// RENDER RESULTS
// ──────────────────────────────────────────────────────────────
function renderResults(data, result) {
  const { total, loadScore, sizeScore, recurScore, focusScore, fragmentScore,
          meetingHrsWeek, meetingsPerDay, avgGapMins, focusHrsDay, freeMinsPerDay, annualCost, bench } = result;

  const g = scoreGrade(total);
  const clr = scoreColor(total);

  // Grade + headline + summary
  const gradeEl = document.getElementById('r-grade');
  gradeEl.textContent = g.label;
  gradeEl.style.color = clr;

  document.getElementById('r-headline').textContent = g.headline;

  // Animal archetype — based on meeting-hour percentile vs benchmark
  const mu    = bench.p50;
  const sigma = iqrSigma(bench.p25, bench.p75);
  const meetingPct = Math.round(normalCDF(meetingHrsWeek, mu, sigma) * 100);
  const animal = getAnimal(meetingPct);
  // Use Railway base URL for animal icons when embedded on another domain
  const _assetBase = (function() {
    const host = document.getElementById('wl-meeting-score');
    return host ? 'https://delightful-transformation-production-bd0f.up.railway.app' : '';
  })();
  document.getElementById('animal-img').src = `${_assetBase}/animal-icons/${animal.file}`;
  document.getElementById('animal-img').alt = animal.name;
  document.getElementById('animal-name').textContent = animal.name;
  document.getElementById('animal-desc').textContent = animal.desc;

  const pctDay = Math.round((meetingHrsWeek / 5 / 8) * 100);
  const avgGapLabel = avgGapMins >= 120 ? `~${fmtHrs(focusHrsDay)} avg uninterrupted block`
                    : avgGapMins >= 60  ? `~${Math.round(avgGapMins)}min avg gap between meetings`
                    : `only ~${Math.round(avgGapMins)}min avg between meetings`;
  document.getElementById('r-summary').textContent =
    `${data.name || 'You'} spend about ${fmtHrs(meetingHrsWeek)}/week in meetings — ` +
    `${pctDay}% of the workday — with ${avgGapLabel}. ` +
    `Your time in meetings costs an estimated ${fmtMoney(annualCost)}/year.`;

  document.getElementById('r-name-inline').textContent = data.name || 'you';

  // Gauge
  animateGauge(total);

  // Metrics
  document.getElementById('r-hrs-wk').textContent = fmtHrs(meetingHrsWeek);
  document.getElementById('r-pct-day').textContent = pctDay + '%';

  const focusEl = document.getElementById('r-focus');
  focusEl.textContent = fmtHrs(focusHrsDay);
  focusEl.className = 'm-val ' + (avgGapMins >= 120 ? 'good' : avgGapMins >= 60 ? 'warn' : 'danger');

  document.getElementById('r-cost').textContent = fmtMoney(annualCost);

  // Chart
  document.getElementById('r-chart-title').textContent =
    `vs. ${BM[data.role].label} Benchmark`;
  document.getElementById('r-bm-med').textContent = bench.p50 + 'h/wk';
  document.getElementById('r-bm-you').textContent = fmtHrs(meetingHrsWeek) + '/wk';
  const canvas = document.getElementById('bench-canvas');
  setTimeout(() => drawBellChart(canvas, meetingHrsWeek, bench), 150);

  // Dimension bars
  const dims = [
    { icon: '⏱', name: 'Load',          score: loadScore,     pct: '35%' },
    { icon: '🎯', name: 'Focus Time',    score: focusScore,    pct: '20%' },
    { icon: '🗓', name: 'Fragmentation', score: fragmentScore, pct: '15%' },
    { icon: '👥', name: 'Meeting Size',  score: sizeScore,     pct: '15%' },
    { icon: '🔁', name: 'Recurrence',    score: recurScore,    pct: '15%' },
  ];
  document.getElementById('dims-list').innerHTML = dims.map(d => `
    <div class="dim-row">
      <div class="dim-icon">${d.icon}</div>
      <div class="dim-name">${d.name}</div>
      <div class="dim-track">
        <div class="dim-bar" data-w="${d.score}" style="width:0%;background:${scoreColor(d.score)}"></div>
      </div>
      <div class="dim-score" style="color:${scoreColor(d.score)}">${d.score}</div>
      <div class="dim-weight">${d.pct}</div>
    </div>
  `).join('');
  setTimeout(() => {
    document.querySelectorAll('.dim-bar').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  }, 250);

  // Typical day timeline
  setTimeout(() => {
    const focusLabel = { ic: 'Flow Time', manager: 'Focus Time', senior_leader: 'Prep Time' }[data.role];
    const container = document.getElementById('timeline-container');
    if (container && typeof renderFocusTimeline === 'function') {
      renderFocusTimeline(container, {
        workStart:            480,
        workEnd:              1080,
        numMeetings:          Math.round(meetingsPerDay),
        meetingMinutes:       Math.round(meetingsPerDay * data.avgDuration),
        numChat:              12,
        numEmails:            6,
        focusHoursDaily:      focusHrsDay,   // match the stat card value exactly
        fragmentedHoursDaily: null,
        focusThr:             120,
        rampMin:              12,
        focusLabel,
      });
    }
  }, 200);

  // Insights
  const insights = buildInsights(data, result);
  document.getElementById('insights-list').innerHTML = insights.map(ins => `
    <div class="insight-row">
      <div class="ins-icon ${ins.type}">${ins.icon}</div>
      <div class="ins-body">
        <h4>${esc(ins.title)}</h4>
        <p>${esc(ins.text)}</p>
      </div>
    </div>
  `).join('');

  // If joining a team, show "View Team Dashboard" button
  if (S.teamEntries.length > 0) {
    document.getElementById('btn-view-team').classList.add('show');
    generateShareLink(); // auto-generate so the link is ready
  }
}

// ──────────────────────────────────────────────────────────────
// SHARE LINK
// ──────────────────────────────────────────────────────────────
function buildShareLink() {
  if (!S.result) return '';
  const myEntry = {
    name:           S.formData.name || 'Anonymous',
    role:           S.formData.role,
    score:          S.result.total,
    meetingHrsWeek: S.result.meetingHrsWeek,
    focusHrsDay:    S.result.focusHrsDay,
    annualCost:     S.result.annualCost,
  };
  const all = [...S.teamEntries, myEntry];
  const encoded = encodeTeam(all);
  const base = location.origin + location.pathname;
  return base + '?t=' + encoded;
}

function generateShareLink() {
  const link = buildShareLink();
  S.shareLink = link;

  document.getElementById('share-link-input').value = link;
  document.getElementById('share-box').classList.add('show');
  document.getElementById('btn-gen-link').textContent = '✓ Link ready';
  document.getElementById('btn-gen-link').disabled = true;
  document.getElementById('btn-gen-link').style.opacity = '0.65';

  // Show "View team dashboard" for the original creator too
  const viewBtn = document.getElementById('btn-view-team');
  viewBtn.textContent = '→ View team dashboard';
  viewBtn.classList.add('show');
}

function copyShareLink(fromTeamView = false) {
  const link = S.shareLink || buildShareLink();
  if (!link) return;

  if (fromTeamView) {
    document.getElementById('t-share-input').value = link;
  }

  navigator.clipboard.writeText(link).then(() => {
    const btns = document.querySelectorAll('.btn-copy');
    btns.forEach(b => {
      b.textContent = 'Copied!';
      setTimeout(() => { b.textContent = 'Copy'; }, 2200);
    });
  }).catch(() => {
    // Fallback: select the input
    const inp = document.getElementById(fromTeamView ? 't-share-input' : 'share-link-input');
    if (inp) { inp.select(); document.execCommand('copy'); }
  });
}

// ──────────────────────────────────────────────────────────────
// TEAM DASHBOARD
// ──────────────────────────────────────────────────────────────
function goToTeamDashboard() {
  const myEntry = {
    name:           S.formData.name || 'Anonymous',
    role:           S.formData.role,
    score:          S.result.total,
    meetingHrsWeek: S.result.meetingHrsWeek,
    focusHrsDay:    S.result.focusHrsDay,
    annualCost:     S.result.annualCost,
  };
  renderTeamDashboard([...S.teamEntries, myEntry]);
  showScreen('team');
}

function renderTeamDashboard(entries) {
  const n = entries.length;

  // Header
  document.getElementById('t-members-title').textContent =
    `Team members · ${n} submitted`;

  // Averages
  const avgScore = Math.round(entries.reduce((s, e) => s + e.score, 0) / n);
  const avgHrs   = entries.reduce((s, e) => s + e.meetingHrsWeek, 0) / n;
  const avgFocus = entries.reduce((s, e) => s + e.focusHrsDay, 0) / n;
  const totCost  = entries.reduce((s, e) => s + e.annualCost, 0);

  const avgNumEl = document.getElementById('t-avg-num');
  avgNumEl.textContent = avgScore;
  avgNumEl.style.color = scoreColor(avgScore);
  document.getElementById('t-avg-sub').textContent =
    `across ${n} team member${n !== 1 ? 's' : ''}`;

  document.getElementById('t-avg-hrs').textContent    = fmtHrs(avgHrs);
  document.getElementById('t-total-cost').textContent = fmtMoney(totCost);
  document.getElementById('t-avg-focus').textContent  = fmtHrs(avgFocus);

  // Members list (sorted best score first)
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  document.getElementById('t-members-list').innerHTML = sorted.map((e, i) => `
    <div class="member-row">
      <div class="member-avatar" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]}">
        ${esc(e.name.charAt(0).toUpperCase())}
      </div>
      <div class="member-info">
        <div class="member-name">${esc(e.name)}</div>
        <div class="member-detail">${esc(ROLE_LABELS[e.role] || e.role)} · ${fmtHrs(e.meetingHrsWeek)}/wk in meetings</div>
      </div>
      <div class="member-right">
        <div class="member-score" style="color:${scoreColor(e.score)}">${e.score}</div>
        <div class="member-sub">${fmtHrs(e.focusHrsDay)}/day focus</div>
      </div>
    </div>
  `).join('');

  // Pre-populate share link
  const link = S.shareLink || buildShareLink();
  if (link) document.getElementById('t-share-input').value = link;
}

// ──────────────────────────────────────────────────────────────
// FORM SUBMIT
// ──────────────────────────────────────────────────────────────
function submitForm() {
  const data = {
    name:            document.getElementById('f-name').value.trim() || 'You',
    email:           document.getElementById('f-email').value.trim(),
    role:            document.querySelector('input[name="role"]:checked')?.value || 'ic',
    orgSize:         document.querySelector('input[name="orgSize"]:checked')?.value || 'small',
    meetingsPerWeek: +document.getElementById('f-meetings').value,
    avgDuration:     +document.getElementById('f-duration').value,
    avgAttendees:    +document.getElementById('f-attendees').value,
    pctRecurring:    +document.getElementById('f-recurring').value,
    hourlyRate:      +document.getElementById('f-rate').value || 150,
  };

  // Fire-and-forget email capture (only if opted in and email provided)
  const optedIn = document.getElementById('f-optin').checked;
  if (optedIn && data.email) {
    // 1. Post to Railway backend (standalone hosting)
    const _apiBase = document.getElementById('wl-meeting-score')
      ? 'https://delightful-transformation-production-bd0f.up.railway.app'
      : '';
    fetch(_apiBase + '/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: data.name, email: data.email, role: data.role }),
    }).catch(() => {});

    // 2. Submit hidden Webflow form via Webflow's own AJAX handler
    const wfForm = document.querySelector('[data-name="Meeting Score Lead"]');
    if (wfForm) {
      // Log actual field names present so mismatches are easy to spot in console
      const allInputs = wfForm.querySelectorAll('input, textarea, select');
      console.log('[WL] Webflow form fields found:', Array.from(allInputs).map(el => el.name));

      // Fill by name attribute — must match exactly what's set in Webflow field settings
      const nameEl  = wfForm.querySelector('[name="lead-name"]');
      const emailEl = wfForm.querySelector('[name="lead-email"]');
      const roleEl  = wfForm.querySelector('[name="lead-role"]');
      console.log('[WL] Fields matched:', { nameEl: !!nameEl, emailEl: !!emailEl, roleEl: !!roleEl });
      if (nameEl)  nameEl.value  = data.name;
      if (emailEl) emailEl.value = data.email;
      if (roleEl)  roleEl.value  = data.role;

      wfForm.noValidate = true;
      wfForm.querySelectorAll('[required]').forEach(el => el.removeAttribute('required'));
      try { wfForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true, composed: true })); }
      catch(e) { console.error('[WL] Form dispatch error:', e); }
    } else {
      console.warn('[WL] Webflow form [data-name="Meeting Score Lead"] not found on page');
    }
  }

  const result = computeScore(data);
  S.formData = data;
  S.result   = result;

  showScreen('results');
  renderResults(data, result);
}

// ──────────────────────────────────────────────────────────────
// INIT — check URL for team param
// ──────────────────────────────────────────────────────────────
(function init() {
  const param = new URLSearchParams(location.search).get('t');
  if (param) {
    const entries = decodeTeam(param);
    if (entries.length > 0) {
      S.teamEntries = entries;
      // Show team join banner
      const n = entries.length;
      document.getElementById('tb-count').textContent =
        `${n} teammate${n !== 1 ? 's' : ''}`;
      document.getElementById('team-banner').classList.add('show');
      // Go straight to form, skip landing
      showScreen('form');
      setStep(1);
      return;
    }
  }
  showScreen('landing');
})();

// ══════════════════════════════════════════════════════════════
// FOCUS TIMELINE VISUALIZATION (inlined from focus_timeline.js)
// ══════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  function makeRNG(seed) {
    let s = (Math.abs(Math.round(seed)) >>> 0) || 1_234_567;
    return () => {
      s ^= s << 13; s ^= s >> 17; s ^= s << 5;
      return (s >>> 0) / 0x1_0000_0000;
    };
  }

  const f = v => Number(v).toFixed(1);

  function generateSchedule({
    meetingMinutes, numMeetings, numChat, numEmails,
    focusHoursDaily, fragmentedHoursDaily, focusThr, workStart, workEnd,
  }) {
    const rng = makeRNG(
      Math.round(meetingMinutes) * 10_007 +
      numMeetings               *    997 +
      numChat                   *    101 +
      numEmails                 *     37
    );
    const buf = 5, aStart = workStart + buf, aEnd = workEnd - buf, aLen = aEnd - aStart;
    const focusMin = focusHoursDaily ? Math.round(focusHoursDaily * 60) : 0;
    const hasFocus = focusMin >= focusThr;
    const focusBuf = 15;
    let focusStart = null, focusEnd = null;
    if (hasFocus) {
      const span = Math.max(0, aLen - focusMin);
      focusStart = Math.round(aStart + (0.15 + rng() * 0.50) * span);
      focusEnd   = focusStart + focusMin;
    }
    const windows = hasFocus
      ? [{ start: aStart, end: focusStart - focusBuf }, { start: focusEnd + focusBuf, end: aEnd }]
          .filter(w => w.end - w.start >= 20)
      : [{ start: aStart, end: aEnd }];
    const totalWinLen = windows.reduce((s, w) => s + Math.max(0, w.end - w.start), 0);
    const meetingDurations = Array.from({ length: numMeetings }, () => rng() < 0.5 ? 30 : 60);
    const sortedPos = Array.from({ length: numMeetings }, rng).sort((a, b) => a - b);
    const meetings = sortedPos.map((pos, idx) => {
      const thisDur = meetingDurations[idx];
      let t = pos * totalWinLen, cumLen = 0;
      for (const w of windows) {
        const wLen = Math.max(0, w.end - w.start);
        if (t <= cumLen + wLen) {
          const localT   = wLen > 0 ? (t - cumLen) / wLen : 0;
          const rawStart = Math.round(w.start + localT * Math.max(0, wLen - thisDur));
          const start    = Math.max(w.start, Math.min(w.end - 15, rawStart));
          const maxDur   = Math.max(15, w.end - start);
          return { type: 'meeting', start, duration: Math.max(15, Math.min(maxDur, thisDur)) };
        }
        cumLen += wLen;
      }
      return { type: 'meeting', start: windows[0]?.start ?? aStart, duration: thisDur };
    });
    meetings.sort((a, b) => a.start - b.start);
    for (let i = 1; i < meetings.length; i++) {
      const prev = meetings[i - 1];
      meetings[i].start = Math.max(meetings[i].start, prev.start + prev.duration + 15);
    }
    const validMeetings = meetings.filter(m => {
      if (m.start + m.duration > aEnd) return false;
      if (hasFocus && m.start < focusEnd + focusBuf && m.start + m.duration > focusStart - focusBuf) return false;
      return true;
    });
    const occupied = [...validMeetings.map(m => ({ s: m.start - 15, e: m.start + m.duration + 15 }))];
    const tryPlace = (type, duration, buffer = 10) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const t = Math.round(aStart + rng() * (aLen - duration));
        if (hasFocus && t + duration > focusStart - focusBuf && t < focusEnd + focusBuf) continue;
        if (!occupied.some(o => t < o.e && t + duration > o.s)) {
          occupied.push({ s: t - buffer, e: t + duration + buffer });
          return { type, start: t, duration };
        }
      }
      return null;
    };
    const emailClusters = Math.max(2, Math.round(numEmails / 3));
    const chatClusters  = Math.max(2, Math.round(numChat   / 4));
    const emailEvents   = Array.from({ length: emailClusters }, () => tryPlace('email', 5, 5)).filter(Boolean);
    const chatEvents    = Array.from({ length: chatClusters  }, () => tryPlace('chat',  5, 5)).filter(Boolean);
    const allEvents     = [...validMeetings, ...emailEvents, ...chatEvents];
    if (fragmentedHoursDaily != null) {
      const targetFragMin = Math.round(fragmentedHoursDaily * 60);
      for (let i = 0; i < 40; i++) {
        const sorted   = allEvents.slice().sort((a, b) => a.start - b.start);
        const fragTotal = getFragmentedBlocks(sorted, workStart, workEnd, focusThr, 15)
          .reduce((s, b) => s + b.end - b.start, 0);
        if (fragTotal <= targetFragMin + 15) break;
        const ev = tryPlace('chat', 5, 5);
        if (!ev) break;
        allEvents.push(ev);
      }
    }
    allEvents.sort((a, b) => a.start - b.start);
    if (hasFocus) {
      const noOverlap = (s, d) => !allEvents.some(e => e.start < s + d && e.start + e.duration > s);
      const tPre  = focusStart - 6, tPost = focusEnd + 2;
      if (tPre  >= workStart && tPre  + 5 <= workEnd && noOverlap(tPre,  5)) allEvents.push({ type: 'chat', start: tPre,  duration: 5 });
      if (tPost >= workStart && tPost + 5 <= workEnd && noOverlap(tPost, 5)) allEvents.push({ type: 'chat', start: tPost, duration: 5 });
      allEvents.sort((a, b) => a.start - b.start);
      allEvents.push({ type: 'fragmented', start: focusStart - 1, duration: 1 });
      allEvents.push({ type: 'fragmented', start: focusEnd,       duration: 1 });
      allEvents.sort((a, b) => a.start - b.start);
    }
    return { events: allEvents, hasFocus, focusStart, focusEnd };
  }

  function buildTimeline(events, workStart, workEnd, focusThr) {
    const classify = dur => dur >= focusThr ? 'focus' : 'fragmented';
    const segs = [];
    let t = workStart;
    for (const ev of events) {
      if (ev.start > t) segs.push({ start: t, end: ev.start, type: classify(ev.start - t), isGap: true });
      segs.push({ start: ev.start, end: ev.start + ev.duration, type: ev.type, isGap: false });
      t = ev.start + ev.duration;
    }
    if (t < workEnd) segs.push({ start: t, end: workEnd, type: classify(workEnd - t), isGap: true });
    return segs;
  }

  function getFocusBlocks(events, workStart, workEnd, focusThr) {
    const blocks = []; let t = workStart;
    for (const ev of events) {
      if (ev.start - t >= focusThr) blocks.push({ start: t, end: ev.start });
      t = ev.start + ev.duration;
    }
    if (workEnd - t >= focusThr) blocks.push({ start: t, end: workEnd });
    return blocks;
  }

  function getFragmentedBlocks(events, workStart, workEnd, focusThr, minGap) {
    const blocks = []; let t = workStart;
    for (const ev of events) {
      const gap = ev.start - t;
      if (gap >= minGap && gap < focusThr) blocks.push({ start: t, end: ev.start });
      t = ev.start + ev.duration;
    }
    const gap = workEnd - t;
    if (gap >= minGap && gap < focusThr) blocks.push({ start: t, end: workEnd });
    return blocks;
  }

  function plateauPath(x0, x3, y0, y1, rampPx) {
    const x1 = x0 + rampPx, x2 = x3 - rampPx, cx = rampPx * 0.55;
    if (x2 <= x1) {
      const mx = (x0 + x3) / 2;
      return `M${f(x0)},${f(y0)} C${f(x0+cx)},${f(y0)} ${f(mx)},${f(y1)} ${f(mx)},${f(y1)} C${f(mx)},${f(y1)} ${f(x3-cx)},${f(y0)} ${f(x3)},${f(y0)} Z`;
    }
    return `M${f(x0)},${f(y0)} C${f(x0+cx)},${f(y0)} ${f(x1-cx)},${f(y1)} ${f(x1)},${f(y1)} L${f(x2)},${f(y1)} C${f(x2+cx)},${f(y1)} ${f(x3-cx)},${f(y0)} ${f(x3)},${f(y0)} Z`;
  }

  function archPath(x0, x3, y0, y1) {
    const w = x3 - x0, mx = (x0 + x3) / 2, hx = w * 0.22;
    return `M${f(x0)},${f(y0)} C${f(x0+hx)},${f(y1)} ${f(mx-hx)},${f(y1)} ${f(mx)},${f(y1)} C${f(mx+hx)},${f(y1)} ${f(x3-hx)},${f(y1)} ${f(x3)},${f(y0)} Z`;
  }

  const TEMPLATE = `
<style>
  .ftl { display:flex; flex-direction:column; width:100%; height:100%; padding:4px 8px 0; box-sizing:border-box; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; justify-content:center; }
  .ftl-chart { flex-shrink:0; position:relative; overflow:hidden; }
  .ftl-stats { text-align:center; flex-shrink:0; margin-top:4px; font-size:12px; color:#64748b; line-height:1.4; }
  .ftl-stats b { font-weight:700; color:#374151; }
  .ftl-legend { display:flex; gap:12px; justify-content:center; flex-shrink:0; margin-top:6px; font-size:11px; color:#374151; flex-wrap:wrap; border:1.5px solid #e2e8f0; border-radius:8px; padding:5px 14px; background:#f8fafc; }
  .ftl-li { display:flex; align-items:center; gap:5px; font-weight:500; }
  .ftl-sw { width:13px; height:13px; border-radius:3px; flex-shrink:0; border:1px solid rgba(0,0,0,0.12); }
  @keyframes ftl-bubble { from { transform:scaleY(0); opacity:0; } to { transform:scaleY(1); opacity:1; } }
  .ftl-shape { transform-box:fill-box; transform-origin:bottom center; animation:ftl-bubble 0.55s cubic-bezier(0.34,1.56,0.64,1) both; }
</style>
<div class="ftl">
  <div class="ftl-chart"><svg id="ftl-svg" style="display:block;overflow:hidden"></svg></div>
  <div class="ftl-stats" id="ftl-stats"></div>
  <div class="ftl-legend">
    <div class="ftl-li"><div class="ftl-sw" style="background:rgba(59,130,246,0.40)"></div><span>Focus Time</span></div>
    <div class="ftl-li"><div class="ftl-sw" style="background:rgba(239,68,68,0.35)"></div><span>Fragmented Time</span></div>
    <div class="ftl-li"><div class="ftl-sw" style="background:#10B981"></div><span>Email</span></div>
    <div class="ftl-li"><div class="ftl-sw" style="background:#F59E0B"></div><span>Chat</span></div>
    <div class="ftl-li"><div class="ftl-sw" style="background:#EF4444"></div><span>Meetings</span></div>
  </div>
</div>`;

  function _draw(element, events, { workStart, workEnd, rampMin, focusThr, hasFocus, focusStart, focusEnd, focusHoursDaily, fragmentedHoursDaily, focusLabel, correctedFocusMin, correctedFragMin }) {
    const svg = element.querySelector('#ftl-svg');
    if (!svg) return;
    const W = Math.max(300, element.clientWidth || 700);
    const H = Math.max(80,  (element.clientHeight || 250) - 72);
    svg.setAttribute('width', W);
    const ML = 36, MR = 36, cW = W - ML - MR, wDur = workEnd - workStart;
    const grayBuf = Math.min(Math.round(cW * 0.03), ML - 4, MR - 4);
    const barY = Math.round(H * 0.62), barH = Math.max(18, Math.round(H * 0.15));
    const maxFH = Math.round(barY * 0.80), svgH = barY + barH + 48;
    svg.setAttribute('height', svgH);
    const tx = t => ML + ((t - workStart) / wDur) * cW;
    const rampPx = (rampMin / wDur) * cW;
    const COLOR = { focus:'#3B82F6', fragmented:'#3B82F6', meeting:'#EF4444', email:'#10B981', chat:'#F59E0B', bg:'#E8EAED' };
    const TIP   = { focus:`${focusLabel} – uninterrupted block for deep work`, fragmented:'Fragmented time – too short for deep work', meeting:'Meeting', email:'Email cluster', chat:'Chat message cluster' };
    const p = [], clipId = 'ftl-bar-clip';
    const fullBarX = ML - grayBuf, fullBarW = cW + grayBuf * 2;
    p.push(`<defs><clipPath id="${clipId}"><rect x="${fullBarX}" y="${barY}" width="${fullBarW}" height="${barH}"/></clipPath></defs>`);
    p.push(`<rect x="${fullBarX}" y="${barY}" width="${fullBarW}" height="${barH}" fill="${COLOR.bg}"/>`);
    p.push(`<g clip-path="url(#${clipId})">`);
    buildTimeline(events, workStart, workEnd, focusThr).forEach(seg => {
      const x = tx(seg.start), w = Math.max(1.5, tx(seg.end) - x), tip = TIP[seg.type] || '';
      p.push(`<rect x="${f(x)}" y="${barY}" width="${f(w)}" height="${barH}" fill="${COLOR[seg.type] || COLOR.bg}">${tip ? `<title>${tip}</title>` : ''}</rect>`);
    });
    p.push('</g>');
    p.push(`<rect x="${fullBarX}" y="${barY}" width="${fullBarW}" height="${barH}" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="1"/>`);
    const focusBlocks = getFocusBlocks(events, workStart, workEnd, focusThr);
    const fragBlocks  = getFragmentedBlocks(events, workStart, workEnd, focusThr, 1);
    [...focusBlocks.map(b => ({ ...b, kind:'focus' })), ...fragBlocks.map(b => ({ ...b, kind:'fragmented' }))].sort((a,b) => a.start - b.start).forEach((block, idx) => {
      const delay = (0.05 + idx * 0.04).toFixed(2);
      if (block.kind === 'focus') {
        const x0 = tx(block.start), x3 = tx(block.end), rp = Math.min(rampPx, (x3-x0)*0.25);
        p.push(`<path d="${plateauPath(x0,x3,barY,barY-maxFH,rp)}" fill="rgba(59,130,246,0.26)" stroke="none" class="ftl-shape" style="animation-delay:${delay}s"><title>${TIP.focus}</title></path>`);
      } else {
        const dur = block.end - block.start, pct = Math.min(1, dur / focusThr);
        const fH = maxFH * (0.20 + 0.80 * Math.pow(pct, 0.6));
        const x0 = tx(block.start), x3 = tx(block.end);
        p.push(`<path d="${archPath(x0,x3,barY,barY-fH)}" fill="rgba(239,68,68,0.22)" stroke="none" class="ftl-shape" style="animation-delay:${delay}s"><title>${TIP.fragmented}</title></path>`);
      }
    });
    const h0 = Math.ceil(workStart / 60), hN = Math.floor(workEnd / 60);
    for (let h = h0; h <= hN; h++) {
      const x = tx(h * 60), lbl = h === 12 ? '12 pm' : h < 12 ? `${h} am` : `${h-12} pm`;
      p.push(`<line x1="${f(x)}" y1="${barY}" x2="${f(x)}" y2="${barY+barH+6}" stroke="#9AA0A6" stroke-width="1" stroke-dasharray="3,3"/>`);
      p.push(`<text x="${f(x)}" y="${barY+barH+18}" text-anchor="middle" font-size="11" fill="#5F6368" font-family="Arial,sans-serif">${lbl}</text>`);
    }
    svg.innerHTML = p.join('\n');
    const statsEl = element.querySelector('#ftl-stats');
    if (statsEl) {
      const fmtTime = min => { const h = Math.floor(min/60), m = Math.round(min%60); return h>0 ? `${h}h ${m}m` : `${m}m`; };
      const interruptions = events.filter(e => e.type==='meeting'||e.type==='email'||e.type==='chat').length;
      const focusMin = correctedFocusMin !== null ? correctedFocusMin : focusBlocks.reduce((s,b) => s+b.end-b.start, 0);
      const fragMin  = correctedFragMin  !== null ? correctedFragMin  : fragBlocks.reduce((s,b) => s+b.end-b.start, 0);
      statsEl.innerHTML = `<b>${interruptions}</b> interruptions · <b>${fmtTime(focusMin)}</b> ${focusLabel.toLowerCase()} · <b>${fmtTime(fragMin)}</b> lost to fragmentation`;
    }
  }

  function renderFocusTimeline(container, opts) {
    const { workStart, workEnd, numMeetings, meetingMinutes, numChat, numEmails, focusHoursDaily, fragmentedHoursDaily, focusThr=120, rampMin=12, focusLabel='Focus Time' } = opts;
    container.innerHTML = TEMPLATE.replace(/Focus Time/g, focusLabel);
    const { events, hasFocus, focusStart, focusEnd } = generateSchedule({ meetingMinutes, numMeetings, numChat, numEmails, focusHoursDaily, fragmentedHoursDaily, focusThr, workStart, workEnd });
    const maxAvailHrs    = Math.max(0, (workEnd - workStart - meetingMinutes) / 60);
    const focusBlocksRaw = getFocusBlocks(events, workStart, workEnd, focusThr);
    const actualFocusHrs = focusHoursDaily != null ? focusHoursDaily : Math.min(focusBlocksRaw.reduce((s,b) => s+b.end-b.start,0)/60, maxAvailHrs);
    const rawFragHrs     = getFragmentedBlocks(events, workStart, workEnd, focusThr, 1).reduce((s,b) => s+b.end-b.start,0)/60;
    const actualFragHrs  = Math.min(rawFragHrs, Math.max(0, maxAvailHrs - actualFocusHrs));
    const drawOpts = { workStart, workEnd, rampMin, focusThr, hasFocus, focusStart, focusEnd, focusHoursDaily, fragmentedHoursDaily, focusLabel, correctedFocusMin: Math.round(actualFocusHrs*60), correctedFragMin: Math.round(actualFragHrs*60) };
    _draw(container, events, drawOpts);
    return { focusHoursActual: actualFocusHrs, fragHoursActual: actualFragHrs };
  }

  global.renderFocusTimeline = renderFocusTimeline;
})(window);
