// 서버(Apps Script 웹앱) 주소 — 배포 ID 가 같으면 코드를 고쳐 다시 배포해도 그대로
var API_URL = 'https://script.google.com/macros/s/AKfycbwkjyAgGjRR4GUsYb4EJMJ883Q7J8ObVf21ofiuJZjlM9S84djN2DJu7lHEdM5ZA7upEg/exec';

/**
 * 서버 함수 부르기. 성공하면 data, 서버가 거절하면 Error(서버 메시지), 연결 문제면 Error(net=true).
 *  opt.get     : true 면 GET ?api=...(읽기 함수만), 아니면 POST(text/plain → CORS 사전 요청 없음)
 *  opt.timeout : 이 시간(ms) 안에 답이 없으면 끊고 연결 문제로 봄(기본 20초)
 *  opt.retry   : 연결 문제일 때 다시 해 볼 횟수(같은 요청을 두 번 받아도 괜찮은 것만)
 */
function api(name, args, opt) {
  opt = opt || {};
  args = args || [];
  var tries = 0;
  function once() {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, opt.timeout || 20000);
    var req;
    if (opt.get) {
      req = fetch(API_URL + '?api=' + encodeURIComponent(name) + '&args=' + encodeURIComponent(JSON.stringify(args)) + '&_=' + Date.now(),
        { method: 'GET', cache: 'no-store', redirect: 'follow', signal: ctl && ctl.signal });
    } else {
      req = fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ api: name, args: args }), redirect: 'follow', signal: ctl && ctl.signal });
    }
    return req.then(function (res) {
      if (!res.ok) throw netErr('HTTP ' + res.status);
      return res.text();
    }).then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw netErr('bad json'); } // 구글 오류 화면(HTML) 등
      if (!j || !j.ok) { var e2 = new Error((j && j.error) || '알 수 없는 오류'); e2.server = true; throw e2; }
      return j.data;
    }, function (e) {
      if (e && e.net) throw e;
      throw netErr(e && e.name === 'AbortError' ? 'timeout' : String(e && e.message || e));
    }).then(function (d) { clearTimeout(timer); return d; }, function (e) {
      clearTimeout(timer);
      if (e.net && tries < (opt.retry || 0)) {
        tries++;
        return new Promise(function (ok) { setTimeout(ok, 1500 * tries); }).then(once);
      }
      throw e;
    });
  }
  return once();
}
function netErr(m) { var e = new Error('연결이 잠깐 끊겼어요. 다시 해 주세요.'); e.net = true; e.detail = m; return e; }

/**
 * 몇 초마다 새로 받기. 응답이 느리거나(slowMs) 실패하면 "다시 연결 중" 띠를 보이고,
 * 실패하면 2초→4초→…최대 10초 간격으로 자동으로 다시 시도. 성공하면 띠를 내리고 원래 간격으로.
 *  fetchFn(): Promise, onData(d), onError(e) → true 를 돌려주면 멈춤
 */
function makePoller(fetchFn, onData, onError, everyMs, jitterMs) {
  var timer = null, slowTimer = null, fails = 0, running = false, seq = 0;
  function next(ms) { clearTimeout(timer); if (running) timer = setTimeout(tick, ms); }
  function tick() {
    if (!running) return;
    var my = ++seq;
    clearTimeout(slowTimer);
    slowTimer = setTimeout(function () { if (my === seq) netBar(true); }, 8000);
    fetchFn().then(function (d) {
      if (my !== seq) return;
      clearTimeout(slowTimer); fails = 0; netBar(false);
      onData(d);
      next(everyMs + Math.random() * (jitterMs || 0));
    }, function (e) {
      if (my !== seq) return;
      clearTimeout(slowTimer);
      if (!e.net && onError && onError(e)) { netBar(false); running = false; return; }
      fails++;
      netBar(true, fails);
      next(Math.min(10000, 2000 * fails));
    });
  }
  return {
    start: function () { running = true; seq++; clearTimeout(timer); tick(); },
    now: function () { if (running) { seq++; clearTimeout(timer); tick(); } },
    stop: function () { running = false; seq++; clearTimeout(timer); clearTimeout(slowTimer); netBar(false); }
  };
}

function netBar(on, fails) {
  var b = document.getElementById('netBar');
  if (!b) { b = document.createElement('div'); b.id = 'netBar'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
  b.textContent = '다시 연결 중…' + (fails > 1 ? ' (' + fails + '번째 시도)' : '') + ' 화면은 그대로 두세요.';
  b.classList.toggle('on', !!on);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function $(id) { return document.getElementById(id); }
function errMsg(e) {
  var m = (e && e.message) || String(e);
  return m.replace(/^Exception:\s*/, '').replace(/^Error:\s*/, '');
}
// 서버 시각과 내 시각 차이를 맞춰 남은 시간 계산
var clockOffset = 0;
function syncClock(serverNow) { if (serverNow) clockOffset = serverNow - Date.now(); }
function leftSec(start, dur) {
  if (!dur) return null;
  return Math.max(0, Math.ceil((start + dur * 1000 - (Date.now() + clockOffset)) / 1000));
}
function fmtSec(s) { if (s == null) return ''; return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
var CIRCLED = ['①', '②', '③', '④', '⑤'];
var PHASE_NAME = { lobby: '대기', r1: '1차 응답', discuss: '토론', r2: '2차 응답', reveal: '답 공개', end: '끝' };
