// ==UserScript==
// @name         EB Auto Score
// @namespace    http://tampermonkey.net/
// @version      3.1.0
// @description  Auto submit score for EB lessons
// @match        https://lms1.wiseman.com.hk/lms/user/secure/course/eb/select_lesson/*
// @grant        none
// @downloadURL https://github.com/CQHcharlie/auto_eb_score/raw/refs/heads/main/eb_auto_score.user.js
// @updateURL https://github.com/CQHcharlie/auto_eb_score/raw/refs/heads/main/eb_auto_score.user.js
// ==/UserScript==

(function () {
    'use strict';

    const LIST_URL = 'https://lms1.wiseman.com.hk/lms/user/secure/course/eb/select_lesson/index.shtml';
    const STATE_KEY = 'eb_auto_state';
    let panel = null;
    let isMinimized = false;
    let isRunning = false;
    let stopRequested = false;

    function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function randFloat(min, max) {
        return Math.random() * (max - min) + min;
    }

    function waitMs(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function saveState(state) {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }

    function clearState() {
        localStorage.removeItem(STATE_KEY);
    }

    function readUISettings() {
        const scoreMode = document.querySelector('input[name="eb-score-mode"]:checked').value;
        return {
            running: true,
            scoreMode: scoreMode,
            scoreFixed: parseInt(document.getElementById('eb-score-fixed').value) || 100,
            scoreMin: parseInt(document.getElementById('eb-score-min').value) || 85,
            scoreMax: parseInt(document.getElementById('eb-score-max').value) || 100,
            delayMin: parseFloat(document.getElementById('eb-delay-min').value) || 1,
            delayMax: parseFloat(document.getElementById('eb-delay-max').value) || 3
        };
    }

    function resolveScore(settings) {
        if (settings.scoreMode === 'fixed') return settings.scoreFixed;
        return randInt(Math.min(settings.scoreMin, settings.scoreMax), Math.max(settings.scoreMin, settings.scoreMax));
    }

    function resolveDelaySec(settings) {
        const lo = Math.min(settings.delayMin, settings.delayMax);
        const hi = Math.max(settings.delayMin, settings.delayMax);
        return Math.round(randFloat(lo, hi) * 60);
    }

    function formatSeconds(s) {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return m + 'm ' + sec + 's';
    }

    function log(msg) {
        const el = document.getElementById('eb-log');
        if (el) {
            const ts = new Date().toLocaleTimeString();
            el.textContent += '[' + ts + '] ' + msg + '\n';
            el.scrollTop = el.scrollHeight;
        }
        console.log('[EB Auto]', msg);
    }

    function createPanel() {
        panel = document.createElement('div');
        panel.id = 'eb-auto-panel';
        panel.innerHTML = `
            <div id="eb-panel-inner">
                <div id="eb-panel-title">
                    <span>EB Auto Score</span>
                    <span>
                        <button id="eb-btn-toggle" title="Minimize/Expand">&#x2212;</button>
                    </span>
                </div>
                <div id="eb-panel-body">
                    <fieldset style="border:1px solid #555;border-radius:4px;padding:8px;margin-bottom:8px;">
                        <legend style="color:#aaa;font-size:12px;">Target Score</legend>
                        <label style="font-size:13px;"><input type="radio" name="eb-score-mode" value="fixed" checked/> Fixed:</label>
                        <input id="eb-score-fixed" type="number" value="100" min="0" max="100" style="width:50px;padding:2px;border-radius:3px;border:1px solid #555;background:#333;color:#fff;"/>
                        <br/>
                        <label style="font-size:13px;"><input type="radio" name="eb-score-mode" value="random"/> Random:</label>
                        <input id="eb-score-min" type="number" value="85" min="0" max="100" style="width:45px;padding:2px;border-radius:3px;border:1px solid #555;background:#333;color:#fff;"/>
                        ~
                        <input id="eb-score-max" type="number" value="100" min="0" max="100" style="width:45px;padding:2px;border-radius:3px;border:1px solid #555;background:#333;color:#fff;"/>
                    </fieldset>

                    <fieldset style="border:1px solid #555;border-radius:4px;padding:8px;margin-bottom:8px;">
                        <legend style="color:#aaa;font-size:12px;">Random Delay (minutes)</legend>
                        <label style="font-size:13px;">Min:</label>
                        <input id="eb-delay-min" type="number" value="1" min="0" step="0.5" style="width:55px;padding:2px;border-radius:3px;border:1px solid #555;background:#333;color:#fff;"/>
                        &nbsp;
                        <label style="font-size:13px;">Max:</label>
                        <input id="eb-delay-max" type="number" value="3" min="0" step="0.5" style="width:55px;padding:2px;border-radius:3px;border:1px solid #555;background:#333;color:#fff;"/>
                    </fieldset>

                    <button id="eb-btn-one" class="eb-btn">Score Current Lesson</button>
                    <button id="eb-btn-all" class="eb-btn eb-btn-blue">Score All Incomplete</button>
                    <button id="eb-btn-stop" class="eb-btn eb-btn-red" style="display:none;">Stop</button>

                    <div id="eb-countdown" style="display:none;text-align:center;font-size:14px;color:#ff0;padding:5px 0;"></div>

                    <div id="eb-log"></div>
                </div>
            </div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            #eb-auto-panel { position:fixed; top:60px; right:15px; z-index:999999; font-family:Arial,sans-serif; user-select:none; }
            #eb-panel-inner { background:#1e1e1e; color:#e0e0e0; border-radius:10px; box-shadow:0 6px 30px rgba(0,0,0,0.6); min-width:300px; border:1px solid #444; }
            #eb-panel-title { padding:10px 14px; background:#2d2d2d; border-radius:10px 10px 0 0; cursor:move; font-weight:bold; display:flex; justify-content:space-between; align-items:center; font-size:14px; border-bottom:1px solid #444; }
            #eb-panel-title button { background:none; border:none; color:#aaa; font-size:20px; cursor:pointer; padding:0 4px; line-height:1; }
            #eb-panel-title button:hover { color:#fff; }
            #eb-panel-body { padding:12px; overflow:hidden; }
            #eb-panel-body.collapsed { max-height:0 !important; padding:0 12px !important; }
            .eb-btn { width:100%; padding:9px; border:none; border-radius:5px; cursor:pointer; font-size:13px; color:#fff; margin-bottom:6px; font-weight:bold; transition:opacity 0.2s; }
            .eb-btn:hover { opacity:0.85; }
            .eb-btn:disabled { opacity:0.4; cursor:not-allowed; }
            #eb-btn-one { background:#4CAF50; }
            #eb-btn-all { background:#2196F3; }
            #eb-btn-stop { background:#f44336; }
            #eb-countdown { background:#2a2a00; border-radius:4px; margin-bottom:4px; }
            #eb-log { max-height:220px; overflow-y:auto; font-size:11px; color:#0f0; background:#111; padding:8px; border-radius:5px; margin-top:6px; white-space:pre-wrap; word-break:break-all; font-family:Consolas,monospace; }
            #eb-log:empty::before { content:'Ready.'; color:#888; }
            fieldset { border-color:#444 !important; }
            fieldset * { vertical-align:middle; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(panel);

        makeDraggable(panel, document.getElementById('eb-panel-title'));
        document.getElementById('eb-btn-toggle').addEventListener('click', togglePanel);
        document.getElementById('eb-btn-one').addEventListener('click', handleScoreCurrent);
        document.getElementById('eb-btn-all').addEventListener('click', handleScoreAll);
        document.getElementById('eb-btn-stop').addEventListener('click', () => {
            stopRequested = true;
            clearState();
            log('Stop requested.');
            setRunning(false);
        });

        const saved = loadState();
        if (saved && saved.running) {
            log('Resuming auto session...');
            applySettingsToUI(saved);
            setTimeout(() => autoLoop(saved), 1500);
        }
    }

    function applySettingsToUI(s) {
        const modeRadio = document.querySelector('input[name="eb-score-mode"][value="' + s.scoreMode + '"]');
        if (modeRadio) modeRadio.checked = true;
        document.getElementById('eb-score-fixed').value = s.scoreFixed || 100;
        document.getElementById('eb-score-min').value = s.scoreMin || 85;
        document.getElementById('eb-score-max').value = s.scoreMax || 100;
        document.getElementById('eb-delay-min').value = s.delayMin || 1;
        document.getElementById('eb-delay-max').value = s.delayMax || 3;
    }

    function togglePanel() {
        const body = document.getElementById('eb-panel-body');
        const btn = document.getElementById('eb-btn-toggle');
        isMinimized = !isMinimized;
        if (isMinimized) {
            body.classList.add('collapsed');
            btn.innerHTML = '&#x2b;';
            btn.title = 'Expand';
        } else {
            body.classList.remove('collapsed');
            btn.innerHTML = '&#x2212;';
            btn.title = 'Minimize';
        }
    }

    function makeDraggable(el, handle) {
        let startX, startY, startLeft, startTop;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            startX = e.clientX;
            startY = e.clientY;
            const rect = el.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            const onMove = (ev) => {
                el.style.left = (startLeft + ev.clientX - startX) + 'px';
                el.style.top = (startTop + ev.clientY - startY) + 'px';
                el.style.right = 'auto';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    function setRunning(running) {
        isRunning = running;
        const btnOne = document.getElementById('eb-btn-one');
        const btnAll = document.getElementById('eb-btn-all');
        const btnStop = document.getElementById('eb-btn-stop');
        if (running) {
            btnOne.disabled = true;
            btnAll.disabled = true;
            btnStop.style.display = 'block';
        } else {
            btnOne.disabled = false;
            btnAll.disabled = false;
            btnStop.style.display = 'none';
        }
    }

    async function showCountdown(seconds) {
        const el = document.getElementById('eb-countdown');
        el.style.display = 'block';
        for (let i = seconds; i >= 0; i--) {
            if (stopRequested) { el.style.display = 'none'; return; }
            el.textContent = 'Next action in ' + formatSeconds(i);
            await waitMs(1000);
        }
        el.style.display = 'none';
    }

    async function initAndCommitAPI(outerIframe, score) {
        const outerWin = outerIframe.contentWindow;
        if (!outerWin || !outerWin.API) {
            log('  ERROR: API not available');
            return false;
        }
        const api = outerWin.API;
        if (api.isInitialized !== 'true') {
            log('  Calling LMSInitialize...');
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
            log('  Direct POST ' + commitUrl);
            log('  HTTP ' + xhr.status + ': ' + xhr.responseText);
            if (xhr.status !== 200) return false;
        } catch (e) {
            log('  XHR failed: ' + e.message);
            return false;
        }

        api.LMSFinish('');
        return true;
    }

    async function handleScoreCurrent() {
        if (isRunning) return;
        setRunning(true);
        log('=== Score Current Lesson ===');
        const overlayPlayer = document.querySelector('.overlay-player');
        if (!overlayPlayer || !overlayPlayer.contentWindow) {
            log('No lesson is currently open!');
            setRunning(false);
            return;
        }
        const score = resolveScore(readUISettings());
        log('Target score: ' + score);
        const result = await initAndCommitAPI(overlayPlayer, score);
        if (result) {
            log('SUCCESS! Score: ' + score);
            log('Refreshing in 3s...');
            await waitMs(3000);
            window.location.href = LIST_URL;
        } else {
            log('FAILED!');
            setRunning(false);
        }
    }

    function handleScoreAll() {
        if (isRunning) return;
        const settings = readUISettings();
        saveState(settings);
        log('=== Score All Incomplete ===');
        log('Settings saved. Navigating to list...');
        window.location.href = LIST_URL;
    }

    function pickRandomIncomplete() {
        const rows = document.querySelectorAll('table tbody tr');
        const tasks = [];
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 4) {
                const link = cells[2] ? cells[2].querySelector('a.popup[data-id]') : null;
                const status = cells[3] ? cells[3].textContent.trim() : '';
                const lower = status.toLowerCase();
                if (link && (lower === 'incomplete' || lower === 'new')) {
                    tasks.push({
                        id: link.dataset.id,
                        name: cells[2].textContent.trim().replace(/\s+/g, ' ').substring(0, 70),
                        status: status
                    });
                }
            }
        });
        if (tasks.length === 0) return null;
        return tasks[randInt(0, tasks.length - 1)];
    }

    async function clickOpenLesson(lessonId) {
        const link = document.querySelector('a.popup[data-id="' + lessonId + '"]');
        if (link) {
            log('  Clicking link to open lesson...');
            link.click();
        } else {
            log('  Link not found, opening via iframe...');
        }

        await waitMs(2000);

        let overlayPlayer = document.querySelector('.overlay-player');
        let attempts = 0;
        while (!overlayPlayer && attempts < 20) {
            await waitMs(500);
            overlayPlayer = document.querySelector('.overlay-player');
            attempts++;
        }

        if (!overlayPlayer) {
            log('  Overlay not appeared, creating manually...');
            const outerSrc = 'selectLesson.do?id=' + encodeURIComponent(lessonId) + '&from=lesson';
            let overlayContainer = document.querySelector('.overlay-container');
            const layout = document.querySelector('.layout') || document.body.firstElementChild;
            if (!overlayContainer) {
                overlayContainer = document.createElement('div');
                overlayContainer.className = 'overlay-container';
                overlayContainer.style.display = 'none';
                const closeBtn = document.createElement('button');
                closeBtn.className = 'overlay-close';
                closeBtn.setAttribute('role', 'button');
                closeBtn.innerHTML = '<i class="wmi">close</i>';
                overlayContainer.appendChild(closeBtn);
                document.body.appendChild(overlayContainer);
            }
            overlayPlayer = document.createElement('iframe');
            overlayPlayer.className = 'overlay-player';
            overlayContainer.appendChild(overlayPlayer);
            document.body.classList.add('overlay-body');
            if (layout) layout.style.display = 'none';
            overlayContainer.style.display = '';
            overlayPlayer.setAttribute('src', outerSrc);
        }

        log('  Waiting for SCORM API...');
        try {
            const outerWin = overlayPlayer.contentWindow;
            for (let i = 0; i < 30; i++) {
                if (outerWin && outerWin.API && outerWin.API.isInitialized === 'true') break;
                await waitMs(1000);
            }
        } catch (e) {
            log('  Iframe access: ' + e.message);
        }

        return overlayPlayer;
    }

    async function autoLoop(settings) {
        setRunning(true);
        stopRequested = false;

        const task = pickRandomIncomplete();
        if (!task) {
            log('No more incomplete/new tasks! All done.');
            clearState();
            setRunning(false);
            return;
        }

        log('Selected: ' + task.name + ' [' + task.status + ']');

        const isNew = task.status.toLowerCase() === 'new';

        log('Opening lesson...');
        const overlayPlayer = await clickOpenLesson(task.id);
        if (!overlayPlayer) {
            log('Failed to open lesson, retrying next round...');
            await waitMs(3000);
            window.location.href = LIST_URL;
            return;
        }

        if (stopRequested) { clearState(); setRunning(false); return; }

        let totalWait = resolveDelaySec(settings);
        if (isNew) {
            log('New task, adding 10s extra...');
            totalWait += 10;
        }

        log('Waiting ' + formatSeconds(totalWait) + ' before scoring...');
        await showCountdown(totalWait);

        if (stopRequested) { clearState(); setRunning(false); return; }

        const score = resolveScore(settings);
        log('Scoring: ' + score);
        const result = await initAndCommitAPI(overlayPlayer, score);

        if (result) {
            log('SUCCESS! Score: ' + score);
        } else {
            log('FAILED!');
        }

        log('Refreshing in 3s...');
        await waitMs(3000);
        saveState(settings);
        window.location.href = LIST_URL;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createPanel);
    } else {
        createPanel();
    }
})();
