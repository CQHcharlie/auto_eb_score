// ==UserScript==
// @name         EB Auto Score
// @namespace    http://tampermonkey.net/
// @version      3.2.0
// @description  Auto submit score for EB lessons
// @match        https://lms1.wiseman.com.hk/lms/user/secure/course/eb/select_lesson/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const LIST_URL = 'https://lms1.wiseman.com.hk/lms/user/secure/course/eb/select_lesson/index.shtml';
    const STATE_KEY = 'eb_auto_state';
    let panel = null;
    let isMinimized = false;
    let isRunning = false;
    let stopRequested = false;

    function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
    function randFloat(a, b) { return Math.random() * (b - a) + a; }
    function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

    function formatSeconds(s) {
        if (s <= 0) return '0s';
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return (m > 0 ? m + 'm ' : '') + sec + 's';
    }

    function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) { return null; } }
    function saveState(s) { localStorage.setItem(STATE_KEY, JSON.stringify(s)); }
    function clearState() { localStorage.removeItem(STATE_KEY); }

    function log(msg) {
        const el = document.getElementById('eb-log');
        if (el) {
            el.textContent += '[' + new Date().toLocaleTimeString() + '] ' + msg + '\n';
            el.scrollTop = el.scrollHeight;
        }
        console.log('[EB Auto]', msg);
    }

    function readUISettings() {
        return {
            scoreMode: document.querySelector('input[name="eb-score-mode"]:checked').value,
            scoreFixed: parseInt(document.getElementById('eb-score-fixed').value) || 100,
            scoreMin: parseInt(document.getElementById('eb-score-min').value) || 85,
            scoreMax: parseInt(document.getElementById('eb-score-max').value) || 100,
            delayMin: parseFloat(document.getElementById('eb-delay-min').value) || 0,
            delayMax: parseFloat(document.getElementById('eb-delay-max').value) || 1
        };
    }

    function resolveScore(s) {
        if (s.scoreMode === 'fixed') return s.scoreFixed;
        return randInt(Math.min(s.scoreMin, s.scoreMax), Math.max(s.scoreMin, s.scoreMax));
    }

    function resolveDelaySec(s) {
        const lo = Math.min(s.delayMin || 0, s.delayMax || 0);
        const hi = Math.max(s.delayMin || 0, s.delayMax || 0);
        return Math.round(randFloat(lo, hi) * 60);
    }

    function applySettingsToUI(s) {
        const r = document.querySelector('input[name="eb-score-mode"][value="' + s.scoreMode + '"]');
        if (r) r.checked = true;
        document.getElementById('eb-score-fixed').value = s.scoreFixed || 100;
        document.getElementById('eb-score-min').value = s.scoreMin || 85;
        document.getElementById('eb-score-max').value = s.scoreMax || 100;
        document.getElementById('eb-delay-min').value = s.delayMin != null ? s.delayMin : 0;
        document.getElementById('eb-delay-max').value = s.delayMax != null ? s.delayMax : 1;
    }

    function setRunning(v) {
        isRunning = v;
        document.getElementById('eb-btn-one').disabled = v;
        document.getElementById('eb-btn-all').disabled = v;
        document.getElementById('eb-btn-stop').style.display = v ? 'block' : 'none';
    }

    async function showCountdown(seconds) {
        if (seconds <= 0) return;
        const el = document.getElementById('eb-countdown');
        el.style.display = 'block';
        for (let i = seconds; i >= 0; i--) {
            if (stopRequested) { el.style.display = 'none'; return; }
            el.textContent = 'Next in ' + formatSeconds(i);
            await waitMs(1000);
        }
        el.style.display = 'none';
    }

    // ---- UI ----

    function createPanel() {
        panel = document.createElement('div');
        panel.id = 'eb-auto-panel';
        panel.innerHTML = `
            <div id="eb-panel-inner">
                <div id="eb-panel-title">
                    <span>EB Auto Score v3.2</span>
                    <button id="eb-btn-toggle" title="Minimize">&#x2212;</button>
                </div>
                <div id="eb-panel-body">
                    <fieldset>
                        <legend>Target Score</legend>
                        <label><input type="radio" name="eb-score-mode" value="fixed" checked/> Fixed:</label>
                        <input id="eb-score-fixed" type="number" value="100" min="0" max="100"/>
                        <br/>
                        <label><input type="radio" name="eb-score-mode" value="random"/> Random:</label>
                        <input id="eb-score-min" type="number" value="85" min="0" max="100"/>
                        ~
                        <input id="eb-score-max" type="number" value="100" min="0" max="100"/>
                    </fieldset>
                    <fieldset>
                        <legend>Random Delay (minutes, allow 0 / decimal)</legend>
                        <label>Min:</label>
                        <input id="eb-delay-min" type="number" value="0.5" min="0" step="0.1"/>
                        <label>Max:</label>
                        <input id="eb-delay-max" type="number" value="2" min="0" step="0.1"/>
                    </fieldset>
                    <button id="eb-btn-one" class="eb-btn">Score Current Lesson</button>
                    <button id="eb-btn-all" class="eb-btn eb-btn-blue">Score All Incomplete</button>
                    <button id="eb-btn-stop" class="eb-btn eb-btn-red" style="display:none;">Stop</button>
                    <div id="eb-countdown"></div>
                    <div id="eb-log"></div>
                </div>
            </div>
        `;
        const style = document.createElement('style');
        style.textContent = `
            #eb-auto-panel{position:fixed;top:60px;right:15px;z-index:999999;font-family:Arial,sans-serif;user-select:none}
            #eb-panel-inner{background:#1e1e1e;color:#e0e0e0;border-radius:10px;box-shadow:0 6px 30px rgba(0,0,0,.6);min-width:300px;border:1px solid #444}
            #eb-panel-title{padding:10px 14px;background:#2d2d2d;border-radius:10px 10px 0 0;cursor:move;font-weight:bold;display:flex;justify-content:space-between;align-items:center;font-size:14px;border-bottom:1px solid #444}
            #eb-panel-title button{background:none;border:none;color:#aaa;font-size:20px;cursor:pointer;padding:0 4px;line-height:1}
            #eb-panel-title button:hover{color:#fff}
            #eb-panel-body{padding:12px;overflow:hidden;transition:max-height .3s}
            #eb-panel-body.collapsed{max-height:0!important;padding:0 12px!important}
            fieldset{border:1px solid #555;border-radius:4px;padding:8px;margin-bottom:8px}
            fieldset legend{color:#aaa;font-size:12px}
            fieldset *{vertical-align:middle}
            fieldset input[type=number]{width:50px;padding:2px;border-radius:3px;border:1px solid #555;background:#333;color:#fff;font-size:13px}
            fieldset label{font-size:13px}
            .eb-btn{width:100%;padding:9px;border:none;border-radius:5px;cursor:pointer;font-size:13px;color:#fff;margin-bottom:6px;font-weight:bold;transition:opacity .2s}
            .eb-btn:hover{opacity:.85}
            .eb-btn:disabled{opacity:.4;cursor:not-allowed}
            #eb-btn-one{background:#4CAF50}
            #eb-btn-all{background:#2196F3}
            #eb-btn-stop{background:#f44336}
            #eb-countdown{display:none;text-align:center;font-size:14px;color:#ff0;padding:5px 0;background:#2a2a00;border-radius:4px;margin-bottom:4px}
            #eb-log{max-height:220px;overflow-y:auto;font-size:11px;color:#0f0;background:#111;padding:8px;border-radius:5px;margin-top:6px;white-space:pre-wrap;word-break:break-all;font-family:Consolas,monospace}
            #eb-log:empty::before{content:'Ready.';color:#888}
        `;
        document.head.appendChild(style);
        document.body.appendChild(panel);

        const title = document.getElementById('eb-panel-title');
        let sx, sy, sl, st;
        title.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            sx = e.clientX; sy = e.clientY;
            const r = panel.getBoundingClientRect();
            sl = r.left; st = r.top;
            const move = ev => { panel.style.left = (sl + ev.clientX - sx) + 'px'; panel.style.top = (st + ev.clientY - sy) + 'px'; panel.style.right = 'auto'; };
            const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });

        document.getElementById('eb-btn-toggle').addEventListener('click', () => {
            const body = document.getElementById('eb-panel-body');
            const btn = document.getElementById('eb-btn-toggle');
            isMinimized = !isMinimized;
            body.classList.toggle('collapsed', isMinimized);
            btn.innerHTML = isMinimized ? '&#x2b;' : '&#x2212;';
            btn.title = isMinimized ? 'Expand' : 'Minimize';
        });

        document.getElementById('eb-btn-one').addEventListener('click', handleScoreCurrent);
        document.getElementById('eb-btn-all').addEventListener('click', handleScoreAll);
        document.getElementById('eb-btn-stop').addEventListener('click', () => {
            stopRequested = true;
            clearState();
            log('Stopped.');
            setRunning(false);
        });

        const saved = loadState();
        if (saved && saved.running) {
            applySettingsToUI(saved.settings);
            log('Resuming...');
            setTimeout(() => resume(saved), 1500);
        }
    }

    // ---- Lesson interaction ----

    async function clickOpenLesson(lessonId) {
        const link = document.querySelector('a.popup[data-id="' + lessonId + '"]');
        if (link) {
            link.click();
        } else {
            log('  Link not found');
            return null;
        }

        await waitMs(1500);

        let overlay = document.querySelector('.overlay-player');
        for (let i = 0; i < 20 && !overlay; i++) {
            await waitMs(500);
            overlay = document.querySelector('.overlay-player');
        }
        if (!overlay) { log('  Overlay failed'); return null; }

        log('  Waiting for SCORM API...');
        try {
            const win = overlay.contentWindow;
            for (let i = 0; i < 30; i++) {
                if (stopRequested) return null;
                if (win && win.API && win.API.isInitialized === 'true') break;
                await waitMs(1000);
            }
        } catch (e) {
            log('  Access error: ' + e.message);
        }

        return overlay;
    }

    async function handleDifficultySelection(overlayPlayer) {
        try {
            const outerDoc = overlayPlayer.contentDocument;
            if (!outerDoc) return;
            const innerIframe = outerDoc.querySelector('iframe');
            if (!innerIframe) return;

            let doc = null;
            for (let i = 0; i < 15; i++) {
                if (stopRequested) return;
                try {
                    doc = innerIframe.contentDocument;
                    if (doc && doc.body && doc.body.innerText && doc.body.innerText.includes('LEVEL OF DIFFICULTY')) break;
                    doc = null;
                } catch (e) {}
                await waitMs(1000);
            }
            if (!doc) return;

            log('  Difficulty selection detected, picking Challenging...');
            const innerWin = innerIframe.contentWindow;

            const challengingEl = findDeepestByText(doc, 'Challenging');
            if (challengingEl) {
                challengingEl.click();
                log('  Clicked Challenging');
                await waitMs(500);
            }

            let startBtn = null;
            for (let i = 0; i < 10; i++) {
                startBtn = Array.from(doc.querySelectorAll('button')).find(b => b.textContent.includes('Start Lessons') && !b.disabled);
                if (startBtn) break;
                await waitMs(500);
            }
            if (startBtn) {
                startBtn.click();
                log('  Clicked Start Lessons');
            } else {
                log('  Start button not ready, trying force click...');
                const anyStart = Array.from(doc.querySelectorAll('button')).find(b => b.textContent.includes('Start Lessons'));
                if (anyStart) { anyStart.click(); log('  Force clicked Start'); }
            }
            await waitMs(3000);

            const doc2 = innerIframe.contentDocument;
            const win2 = innerIframe.contentWindow;
            if (doc2 && win2) {
                const options = findAnswerOptions(doc2, win2);
                if (options.length > 0) {
                    options[Math.floor(Math.random() * options.length)].click();
                    await waitMs(500);
                    const sub = Array.from(doc2.querySelectorAll('button')).find(b => b.textContent.includes('Submit') && !b.disabled);
                    if (sub) sub.click();
                    log('  Answered first question randomly');
                    await waitMs(500);
                }
            }
        } catch (e) {
            log('  Difficulty error: ' + e.message);
        }
    }

    function findDeepestByText(doc, text) {
        const xpath = `.//*[contains(text(),'${text}')]`;
        const r = doc.evaluate(xpath, doc.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = r.snapshotLength - 1; i >= 0; i--) {
            const el = r.snapshotItem(i);
            if (el.textContent.trim().length < 50) return el;
        }
        return null;
    }

    function findAnswerOptions(doc, win) {
        try {
            const all = doc.querySelectorAll('div, span');
            const ptr = [];
            for (const el of all) {
                if (el.children.length > 2) continue;
                const t = el.textContent.trim();
                if (t.length < 3 || t.length > 100) continue;
                try { if (win.getComputedStyle(el).cursor === 'pointer') ptr.push(el); } catch (e) {}
            }
            const groups = {};
            for (const el of ptr) {
                const p = el.parentElement;
                if (!p) continue;
                if (!groups[p]) groups[p] = [];
                groups[p].push(el);
            }
            let best = [];
            for (const p in groups) { if (groups[p].length > best.length) best = groups[p]; }
            return best.length >= 2 ? best : [];
        } catch (e) { return []; }
    }

    async function initAndCommitAPI(outerIframe, score) {
        const outerWin = outerIframe.contentWindow;
        if (!outerWin || !outerWin.API) {
            log('  ERROR: No API');
            return false;
        }
        const api = outerWin.API;
        if (api.isInitialized !== 'true') {
            api.LMSInitialize('');
            await waitMs(500);
        }
        if (api.isInitialized !== 'true') {
            log('  ERROR: Init failed');
            return false;
        }

        api.LMSSetValue('cmi.core.score.raw', String(score));
        api.LMSSetValue('cmi.core.lesson_status', 'completed');

        const commitUrl = new URL('commit.do', outerWin.location.href).href;
        const payload = 'token=' + api.token + '&data=' + encodeURIComponent(JSON.stringify(api.cmiData));

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', commitUrl, false);
            xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
            xhr.send(payload);
            log('  POST ' + commitUrl + ' -> HTTP ' + xhr.status);
            if (xhr.status !== 200) return false;
        } catch (e) {
            log('  XHR error: ' + e.message);
            return false;
        }

        api.LMSFinish('');
        return true;
    }

    // ---- Task scanning ----

    function pickRandomIncomplete() {
        const tasks = [];
        document.querySelectorAll('table tbody tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) return;
            const link = cells[2] && cells[2].querySelector('a.popup[data-id]');
            const status = cells[3] ? cells[3].textContent.trim() : '';
            const lower = status.toLowerCase();
            if (link && (lower === 'incomplete' || lower === 'new')) {
                tasks.push({
                    id: link.dataset.id,
                    name: cells[2].textContent.trim().replace(/\s+/g, ' ').substring(0, 70),
                    status: status
                });
            }
        });
        return tasks.length > 0 ? tasks[randInt(0, tasks.length - 1)] : null;
    }

    // ---- Main flow ----

    async function doPhaseEnter(state) {
        setRunning(true);
        log('=== ENTER (first visit): ' + (state.lessonName || state.lessonId) + ' ===');

        const overlay = await clickOpenLesson(state.lessonId);
        if (!overlay) {
            log('  Failed to open, skipping...');
            await finishAndNext(state);
            return;
        }

        await handleDifficultySelection(overlay);

        log('  First visit done, waiting 3s...');
        await waitMs(3000);

        if (stopRequested) { clearState(); setRunning(false); return; }

        state.phase = 'score';
        saveState(state);
        log('  Refreshing to list...');
        window.location.href = LIST_URL;
    }

    async function doPhaseScore(state) {
        setRunning(true);
        log('=== SCORE (second visit): ' + (state.lessonName || state.lessonId) + ' ===');

        const overlay = await clickOpenLesson(state.lessonId);
        if (!overlay) {
            log('  Failed to open, skipping...');
            await finishAndNext(state);
            return;
        }

        if (stopRequested) { clearState(); setRunning(false); return; }

        const delaySec = resolveDelaySec(state.settings);
        if (delaySec > 0) {
            log('  Delay: ' + formatSeconds(delaySec));
            await showCountdown(delaySec);
        }

        if (stopRequested) { clearState(); setRunning(false); return; }

        const score = resolveScore(state.settings);
        log('  Committing score: ' + score);
        const ok = await initAndCommitAPI(overlay, score);
        log(ok ? '  SUCCESS!' : '  FAILED!');

        log('  Waiting 3s...');
        await waitMs(3000);

        await finishAndNext(state);
    }

    async function finishAndNext(state) {
        if (stopRequested) { clearState(); setRunning(false); return; }

        if (state.mode === 'all') {
            state.phase = 'enter';
            delete state.lessonId;
            delete state.lessonName;
            delete state.lessonStatus;
            saveState(state);
            log('  Next lesson...');
            window.location.href = LIST_URL;
        } else {
            clearState();
            setRunning(false);
            log('  Done. Refreshing...');
            window.location.href = LIST_URL;
        }
    }

    // ---- Button handlers ----

    async function handleScoreCurrent() {
        if (isRunning) return;

        const overlay = document.querySelector('.overlay-player');
        if (!overlay || !overlay.contentWindow) {
            log('No lesson is currently open!');
            return;
        }

        const src = overlay.getAttribute('src') || '';
        const m = src.match(/id=([^&]+)/);
        if (!m) { log('Cannot detect lesson ID'); return; }

        const settings = readUISettings();
        const lessonId = m[1];

        setRunning(true);
        log('=== CURRENT LESSON: First visit ===');

        await handleDifficultySelection(overlay);

        log('  Waiting 3s (first visit)...');
        await waitMs(3000);

        if (stopRequested) { clearState(); setRunning(false); return; }

        saveState({
            running: true,
            mode: 'one',
            phase: 'score',
            lessonId: lessonId,
            lessonName: '(current)',
            lessonStatus: '',
            settings: settings
        });
        log('  Refreshing...');
        window.location.href = LIST_URL;
    }

    function handleScoreAll() {
        if (isRunning) return;
        const settings = readUISettings();
        saveState({
            running: true,
            mode: 'all',
            phase: 'enter',
            lessonId: null,
            lessonName: null,
            lessonStatus: null,
            settings: settings
        });
        log('Starting auto-score-all...');
        window.location.href = LIST_URL;
    }

    // ---- Resume ----

    async function resume(state) {
        if (!state || !state.running) return;

        if (state.phase === 'enter') {
            if (!state.lessonId) {
                const task = pickRandomIncomplete();
                if (!task) {
                    log('All tasks completed!');
                    clearState();
                    setRunning(false);
                    return;
                }
                state.lessonId = task.id;
                state.lessonName = task.name;
                state.lessonStatus = task.status;
            }
            await doPhaseEnter(state);
        } else if (state.phase === 'score') {
            await doPhaseScore(state);
        }
    }

    // ---- Init ----

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createPanel);
    } else {
        createPanel();
    }
})();
