// ==UserScript==
// @name         EB Auto Score
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Auto submit score for EB lessons
// @match        https://lms1.wiseman.com.hk/lms/user/secure/course/eb/select_lesson/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const LIST_URL = 'https://lms1.wiseman.com.hk/lms/user/secure/course/eb/select_lesson/index.shtml';
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

    function log(msg) {
        const el = document.getElementById('eb-log');
        if (el) {
            const ts = new Date().toLocaleTimeString();
            el.textContent += '[' + ts + '] ' + msg + '\n';
            el.scrollTop = el.scrollHeight;
        }
        console.log('[EB Auto]', msg);
    }

    function getScoreMode() {
        return document.querySelector('input[name="eb-score-mode"]:checked').value;
    }

    function getTargetScore() {
        const mode = getScoreMode();
        if (mode === 'fixed') {
            return parseInt(document.getElementById('eb-score-fixed').value) || 100;
        }
        const min = parseInt(document.getElementById('eb-score-min').value) || 80;
        const max = parseInt(document.getElementById('eb-score-max').value) || 100;
        return randInt(Math.min(min, max), Math.max(min, max));
    }

    function getDelaySeconds() {
        const min = parseFloat(document.getElementById('eb-delay-min').value) || 1;
        const max = parseFloat(document.getElementById('eb-delay-max').value) || 3;
        const lo = Math.min(min, max);
        const hi = Math.max(min, max);
        return Math.round(randFloat(lo, hi) * 60);
    }

    function formatSeconds(s) {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return m + 'm ' + sec + 's';
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
            #eb-panel-body { padding:12px; transition:max-height 0.3s ease; overflow:hidden; }
            #eb-panel-body.collapsed { max-height:0 !important; padding:0 12px !important; overflow:hidden; }
            .eb-btn { width:100%; padding:9px; border:none; border-radius:5px; cursor:pointer; font-size:13px; color:#fff; margin-bottom:6px; font-weight:bold; transition:opacity 0.2s; }
            .eb-btn:hover { opacity:0.85; }
            .eb-btn:disabled { opacity:0.4; cursor:not-allowed; }
            #eb-btn-one { background:#4CAF50; }
            #eb-btn-all { background:#2196F3; }
            #eb-btn-stop { background:#f44336; }
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
        document.getElementById('eb-btn-stop').addEventListener('click', () => { stopRequested = true; log('Stop requested...'); });
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
        if (!outerWin.API) {
            log('  API not found, waiting...');
            await waitMs(2000);
        }
        if (!outerWin.API) {
            log('  ERROR: API still not available');
            return false;
        }
        const api = outerWin.API;
        if (api.isInitialized !== 'true') {
            api.LMSInitialize('');
            await waitMs(500);
        }
        api.LMSSetValue('cmi.core.score.raw', String(score));
        api.LMSSetValue('cmi.core.lesson_status', 'completed');
        const commitResult = api.LMSCommit('');
        log('  Commit: ' + commitResult + ', Score: ' + api.LMSGetValue('cmi.core.score.raw'));
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
        const score = getTargetScore();
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

    async function handleScoreAll() {
        if (isRunning) return;
        setRunning(true);
        stopRequested = false;
        log('=== Score All Incomplete ===');

        if (window.location.href.indexOf('index.shtml') === -1 &&
            window.location.href.indexOf('goLessonListWithLevelId') === -1 &&
            window.location.href.indexOf('select_lesson/') === -1) {
            log('Navigating to lesson list...');
            window.location.href = LIST_URL;
            return;
        }

        let round = 0;
        while (!stopRequested) {
            round++;
            log('--- Round ' + round + ' ---');
            await waitMs(2000);

            const task = pickRandomIncomplete();
            if (!task) {
                log('No more incomplete/new tasks! All done.');
                break;
            }

            log('Selected: ' + task.name + ' [' + task.status + ']');

            if (stopRequested) break;

            const isNew = task.status.toLowerCase() === 'new';
            const delaySec = getDelaySeconds();
            const extraSec = isNew ? 10 : 0;
            const totalWait = extraSec + delaySec;

            if (isNew) {
                log('New task, extra 10s wait...');
                await waitMs(10000);
                if (stopRequested) break;
            }

            log('Random delay: ' + formatSeconds(totalWait));
            await showCountdown(totalWait);
            if (stopRequested) break;

            const score = getTargetScore();
            log('Opening lesson...');
            const result = await openAndScore(task.id, score);
            if (result) {
                log('SUCCESS! Score: ' + score);
            } else {
                log('FAILED, trying next...');
            }
        }

        log('Finished. Reloading...');
        setRunning(false);
        await waitMs(2000);
        window.location.reload();
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

    async function openAndScore(lessonId, score) {
        const outerSrc = 'selectLesson.do?id=' + encodeURIComponent(lessonId) + '&from=lesson';

        let overlayContainer = document.querySelector('.overlay-container');
        let overlayPlayer = document.querySelector('.overlay-player');
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

        if (overlayPlayer) overlayPlayer.remove();
        overlayPlayer = document.createElement('iframe');
        overlayPlayer.className = 'overlay-player';
        overlayContainer.appendChild(overlayPlayer);

        document.body.classList.add('overlay-body');
        if (layout) layout.style.display = 'none';
        overlayContainer.style.display = '';

        overlayPlayer.setAttribute('src', outerSrc);

        log('  Loading outer iframe...');
        await new Promise(r => { overlayPlayer.addEventListener('load', r, { once: true }); });
        await waitMs(4000);

        try {
            const outerDoc = overlayPlayer.contentDocument;
            const innerIframe = outerDoc.querySelector('iframe[name="course"]') || outerDoc.querySelector('iframe');
            if (innerIframe) {
                log('  Loading course...');
                await new Promise(r => { innerIframe.addEventListener('load', r, { once: true }); setTimeout(r, 20000); });
                await waitMs(3000);
            }
        } catch (e) {
            log('  Iframe access: ' + e.message);
        }

        log('  Committing score...');
        const result = await initAndCommitAPI(overlayPlayer, score);

        overlayPlayer.remove();
        if (layout) layout.style.display = '';
        overlayContainer.style.display = 'none';
        document.body.classList.remove('overlay-body');

        return result;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createPanel);
    } else {
        createPanel();
    }
})();
