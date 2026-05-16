// ==UserScript==
// @name         EB Auto Score
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Auto submit score for EB lessons
// @match        https://lms1.wiseman.com.hk/lms/user/secure/course/eb/select_lesson/*
// @grant        none
// @author       Devcme
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    let panel = null;

    function createPanel() {
        panel = document.createElement('div');
        panel.id = 'eb-auto-panel';
        panel.innerHTML = `
            <div id="eb-panel-inner">
                <div id="eb-panel-title">EB Auto Score</div>
                <div id="eb-panel-body">
                    <label>Target Score: <input id="eb-target-score" type="number" value="100" min="0" max="100" /></label>
                    <br/><br/>
                    <button id="eb-btn-one">Score Current Lesson</button>
                    <br/><br/>
                    <button id="eb-btn-all">Score All Incomplete Lessons</button>
                    <br/><br/>
                    <div id="eb-log" style="max-height:200px;overflow-y:auto;font-size:12px;color:#0f0;background:#111;padding:5px;border-radius:4px;margin-top:5px;"></div>
                </div>
            </div>
        `;
        const style = document.createElement('style');
        style.textContent = `
            #eb-auto-panel { position:fixed; top:10px; right:10px; z-index:999999; font-family:Arial,sans-serif; }
            #eb-panel-inner { background:#222; color:#fff; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.5); min-width:280px; }
            #eb-panel-title { padding:10px 15px; background:#333; border-radius:8px 8px 0 0; cursor:move; font-weight:bold; display:flex; justify-content:space-between; align-items:center; }
            #eb-panel-body { padding:15px; }
            #eb-btn-one, #eb-btn-all { width:100%; padding:8px; border:none; border-radius:4px; cursor:pointer; font-size:14px; color:#fff; }
            #eb-btn-one { background:#4CAF50; }
            #eb-btn-one:hover { background:#45a049; }
            #eb-btn-all { background:#2196F3; }
            #eb-btn-all:hover { background:#1976D2; }
            #eb-target-score { width:60px; padding:4px; border-radius:3px; border:1px solid #555; background:#333; color:#fff; }
            #eb-log { margin-top:10px; white-space:pre-wrap; word-break:break-all; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(panel);

        document.getElementById('eb-btn-one').addEventListener('click', scoreCurrentLesson);
        document.getElementById('eb-btn-all').addEventListener('click', scoreAllIncomplete);
    }

    function log(msg) {
        const el = document.getElementById('eb-log');
        if (el) {
            el.textContent += msg + '\n';
            el.scrollTop = el.scrollHeight;
        }
        console.log('[EB Auto]', msg);
    }

    function getScore() {
        return parseInt(document.getElementById('eb-target-score').value) || 100;
    }

    function waitForIframe(parentDoc, selector, timeout) {
        return new Promise((resolve, reject) => {
            const found = parentDoc.querySelector(selector);
            if (found && found.contentDocument) {
                resolve(found);
                return;
            }
            const timer = setInterval(() => {
                const el = parentDoc.querySelector(selector);
                if (el && el.contentDocument) {
                    clearInterval(timer);
                    resolve(el);
                }
            }, 500);
            setTimeout(() => { clearInterval(timer); reject('timeout'); }, timeout || 30000);
        });
    }

    function waitMs(ms) {
        return new Promise(r => setTimeout(r, ms));
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
        api.LMSSetValue('cmi.core.lesson_status', score > 0 ? 'completed' : 'completed');

        const commitResult = api.LMSCommit('');
        log('  Commit result: ' + commitResult);
        log('  Score set to: ' + api.LMSGetValue('cmi.core.score.raw'));

        api.LMSFinish('');

        return true;
    }

    async function scoreLessonById(lessonId, score) {
        log('Opening lesson: ' + lessonId);

        const outerSrc = 'selectLesson.do?id=' + encodeURIComponent(lessonId) + '&from=lesson';

        let overlayContainer = document.querySelector('.overlay-container');
        let overlayPlayer = document.querySelector('.overlay-player');
        let layout = document.querySelector('.layout') || document.body.firstElementChild;

        if (!overlayContainer) {
            overlayContainer = document.createElement('div');
            overlayContainer.className = 'overlay-container';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'overlay-close';
            closeBtn.setAttribute('role', 'button');
            closeBtn.innerHTML = '<i class="wmi">close</i>';
            overlayContainer.appendChild(closeBtn);
            document.body.appendChild(overlayContainer);
        }

        if (!overlayPlayer) {
            overlayPlayer = document.createElement('iframe');
            overlayPlayer.className = 'overlay-player';
            overlayContainer.appendChild(overlayPlayer);
        }

        document.body.classList.add('overlay-body');
        if (layout) layout.style.display = 'none';
        overlayContainer.style.display = '';

        overlayPlayer.src = outerSrc;

        log('  Waiting for outer iframe to load...');
        await new Promise((resolve) => {
            overlayPlayer.addEventListener('load', resolve, { once: true });
        });
        await waitMs(3000);

        try {
            const outerDoc = overlayPlayer.contentDocument;
            const innerIframe = outerDoc.querySelector('iframe[name="course"]') || outerDoc.querySelector('iframe');
            if (!innerIframe) {
                log('  No inner iframe found');
                return false;
            }

            log('  Waiting for inner iframe (course) to load...');
            await new Promise((resolve) => {
                innerIframe.addEventListener('load', resolve, { once: true });
                setTimeout(resolve, 15000);
            });
            await waitMs(5000);
        } catch (e) {
            log('  Inner iframe access error: ' + e.message);
        }

        log('  Calling initAndCommitAPI...');
        const result = await initAndCommitAPI(overlayPlayer, score);

        document.body.classList.add('overlay-body');
        overlayPlayer.remove();
        if (layout) layout.style.display = '';
        overlayContainer.style.display = 'none';

        return result;
    }

    async function scoreCurrentLesson() {
        log('--- Score Current Lesson ---');
        const overlayPlayer = document.querySelector('.overlay-player');
        if (!overlayPlayer || !overlayPlayer.contentWindow) {
            log('No lesson is currently open!');
            return;
        }
        const score = getScore();
        const result = await initAndCommitAPI(overlayPlayer, score);
        if (result) {
            log('SUCCESS! Score: ' + score);
        } else {
            log('FAILED!');
        }
    }

    async function scoreAllIncomplete() {
        log('--- Score All Incomplete Lessons ---');
        const score = getScore();
        const rows = document.querySelectorAll('table tbody tr');
        const incomplete = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 4) {
                const link = cells[2] ? cells[2].querySelector('a.popup[data-id]') : null;
                const status = cells[3] ? cells[3].textContent.trim() : '';
                if (link && (status === 'Incomplete' || status === 'incomplete' || status === 'New' || status === 'new')) {
                    incomplete.push({
                        id: link.dataset.id,
                        name: cells[2].textContent.trim().replace(/\s+/g, ' ').substring(0, 60),
                        status: status
                    });
                }
            }
        });

        log('Found ' + incomplete.length + ' incomplete/new lessons');

        for (let i = 0; i < incomplete.length; i++) {
            const lesson = incomplete[i];
            log('[' + (i + 1) + '/' + incomplete.length + '] ' + lesson.name);
            try {
                const result = await scoreLessonById(lesson.id, score);
                if (result) {
                    log('  SUCCESS!');
                } else {
                    log('  FAILED, skipping...');
                }
            } catch (e) {
                log('  Error: ' + e.message);
            }
            await waitMs(2000);
        }

        log('All done! Reloading page in 3s...');
        await waitMs(3000);
        window.location.reload();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createPanel);
    } else {
        createPanel();
    }
})();
