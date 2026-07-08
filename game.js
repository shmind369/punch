(() => {
    'use strict';

    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const GROUND_Y = H - 70;

    const hud = document.getElementById('hud');
    const el = {
        playerName: document.getElementById('player-name'),
        enemyName: document.getElementById('enemy-name'),
        playerHP: document.getElementById('player-hp'),
        enemyHP: document.getElementById('enemy-hp'),
        playerLives: document.getElementById('player-lives'),
        stars: document.getElementById('stars'),
    };

    // ---------- input ----------
    const keys = new Set();
    const justPressed = new Set();
    const WATCHED = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'KeyZ', 'KeyX']);
    window.addEventListener('keydown', (e) => {
        if (WATCHED.has(e.code)) e.preventDefault();
        if (!keys.has(e.code)) justPressed.add(e.code);
        keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));

    function rand(min, max) { return min + Math.random() * (max - min); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    // ---------- opponent definitions ----------
    const OPPONENTS = [
        {
            name: 'グリーン・タンク',
            color: '#4be04b', dark: '#1c6b1c',
            maxHP: 100,
            minDelay: 950, maxDelay: 1750,
            telegraph: 700, active: 180, recover: 900,
            dmgHook: 10, dmgBody: 9,
            weights: { hookL: 3, hookR: 3, body: 2, rest: 1 },
        },
        {
            name: 'アイアン・ケイン',
            color: '#ff5c4d', dark: '#8a1f14',
            maxHP: 130,
            minDelay: 750, maxDelay: 1400,
            telegraph: 520, active: 160, recover: 750,
            dmgHook: 13, dmgBody: 11,
            weights: { hookL: 3, hookR: 3, body: 3, rest: 1 },
        },
        {
            name: 'サンダー・ヴォルフ',
            color: '#b98bff', dark: '#5b2fa3',
            maxHP: 160,
            minDelay: 550, maxDelay: 1100,
            telegraph: 380, active: 150, recover: 620,
            dmgHook: 16, dmgBody: 13,
            weights: { hookL: 4, hookR: 4, body: 4, rest: 1 },
        },
    ];

    const BASE_PUNCH = 6;
    const COUNTER_PUNCH = 11;
    const SPECIAL_DMG = 32;
    const PLAYER_MAX_HP = 100;
    const MAX_LIVES = 3;
    const MAX_STARS = 4;

    // ---------- game state ----------
    let state = 'TITLE'; // TITLE, SELECT, READY, FIGHT, DOWN, ROUND_WIN, GAME_OVER, GAME_CLEAR
    let stateTimer = 0;
    let selectedIndex = 0;
    let opponentIndex = 0;
    let defeated = [false, false, false];
    let lives = MAX_LIVES;
    let stars = 0;
    let message = '';

    let player, enemy;

    function newPlayer() {
        return {
            hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
            x: 190, y: GROUND_Y,
            action: 'idle', busyTimer: 0,
            hitFlash: 0,
        };
    }

    function newEnemy(def) {
        return {
            def, hp: def.maxHP, maxHp: def.maxHP,
            x: W - 190, y: GROUND_Y,
            phase: 'guard', timer: rand(def.minDelay, def.maxDelay),
            attackType: null, lastAttackType: null,
            hitFlash: 0,
        };
    }

    function startMatch(idx) {
        opponentIndex = idx;
        player = newPlayer();
        enemy = newEnemy(OPPONENTS[idx]);
        stars = 0;
        state = 'READY';
        stateTimer = 1400;
        message = `ROUND ${idx + 1}`;
    }

    function startNewGame() {
        defeated = [false, false, false];
        lives = MAX_LIVES;
        startMatch(0);
    }

    // ---------- opponent AI ----------
    function pickAttack(o) {
        const w = o.def.weights;
        const entries = Object.entries(w);
        let total = entries.reduce((s, [, v]) => s + v, 0);
        for (let attempt = 0; attempt < 4; attempt++) {
            let r = Math.random() * total;
            let chosen = entries[0][0];
            for (const [k, v] of entries) {
                if (r < v) { chosen = k; break; }
                r -= v;
            }
            if (chosen !== o.lastAttackType || attempt === 3) return chosen;
        }
        return entries[0][0];
    }

    function startNextAttack(o) {
        const type = pickAttack(o);
        o.lastAttackType = type;
        if (type === 'rest') {
            o.phase = 'rest';
            o.attackType = 'rest';
            o.timer = 950;
        } else {
            o.phase = 'telegraph';
            o.attackType = type;
            o.timer = o.def.telegraph;
        }
    }

    function resolveOpponentAttack(o) {
        const busy = player.busyTimer > 0;
        let avoided = false;
        if (!busy) {
            if (o.attackType === 'hookL' && keys.has('ArrowLeft')) avoided = true;
            else if (o.attackType === 'hookR' && keys.has('ArrowRight')) avoided = true;
            else if (o.attackType === 'body' && keys.has('ArrowDown')) avoided = true;
        }
        if (avoided) {
            stars = clamp(stars + 1, 0, MAX_STARS);
        } else {
            const dmg = o.attackType === 'body' ? o.def.dmgBody : o.def.dmgHook;
            damagePlayer(dmg);
        }
    }

    function updateOpponent(dt) {
        if (state !== 'FIGHT') return;
        enemy.timer -= dt;
        enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
        if (enemy.timer > 0) return;
        switch (enemy.phase) {
            case 'guard':
                startNextAttack(enemy);
                break;
            case 'telegraph':
                enemy.phase = 'active';
                enemy.timer = enemy.def.active;
                break;
            case 'active':
                resolveOpponentAttack(enemy);
                enemy.attackType = null;
                enemy.phase = 'recover';
                enemy.timer = enemy.def.recover;
                break;
            case 'recover':
            case 'rest':
                enemy.phase = 'guard';
                enemy.attackType = null;
                enemy.timer = rand(enemy.def.minDelay, enemy.def.maxDelay);
                break;
        }
    }

    // ---------- player actions ----------
    function updatePlayer(dt) {
        player.hitFlash = Math.max(0, player.hitFlash - dt);
        if (player.busyTimer > 0) {
            player.busyTimer -= dt;
            if (player.busyTimer <= 0) {
                player.busyTimer = 0;
                if (player.action !== 'down') player.action = 'idle';
            }
        }
        if (state !== 'FIGHT') return;

        if (player.action === 'hitstun' || player.action === 'down') return;

        if (justPressed.has('KeyZ')) tryPlayerPunch('L');
        else if (justPressed.has('KeyX')) tryPlayerPunch('R');
        else if (justPressed.has('Space')) trySpecial();

        if (player.busyTimer > 0) return;

        if (keys.has('ArrowDown')) player.action = 'block';
        else if (keys.has('ArrowLeft')) player.action = 'dodgeL';
        else if (keys.has('ArrowRight')) player.action = 'dodgeR';
        else player.action = 'idle';
    }

    function tryPlayerPunch(side) {
        if (player.busyTimer > 0) return;
        player.action = side === 'L' ? 'punchL' : 'punchR';
        player.busyTimer = 260;

        if (enemy.phase === 'telegraph') {
            // bonus read damage, but the incoming attack still must be dodged/blocked
            dealDamageToEnemy(COUNTER_PUNCH);
            stars = clamp(stars + 1, 0, MAX_STARS);
        } else if (enemy.phase === 'recover' || enemy.phase === 'rest') {
            dealDamageToEnemy(BASE_PUNCH);
        }
        // guard / active -> whiffed, no effect
    }

    function trySpecial() {
        if (stars < MAX_STARS || player.busyTimer > 0) return;
        stars = 0;
        player.action = 'special';
        player.busyTimer = 520;
        dealDamageToEnemy(SPECIAL_DMG);
    }

    function dealDamageToEnemy(dmg) {
        enemy.hp = clamp(enemy.hp - dmg, 0, enemy.maxHp);
        enemy.hitFlash = 180;
        if (enemy.hp <= 0) {
            defeated[opponentIndex] = true;
            state = 'ROUND_WIN';
            stateTimer = 1800;
            message = `${enemy.def.name} K.O.!!`;
        }
    }

    function damagePlayer(dmg) {
        player.hp = clamp(player.hp - dmg, 0, player.maxHp);
        player.hitFlash = 220;
        player.action = 'hitstun';
        player.busyTimer = 320;
        if (player.hp <= 0) {
            player.action = 'down';
            lives -= 1;
            if (lives <= 0) {
                state = 'GAME_OVER';
                stateTimer = 2200;
                message = 'GAME OVER';
            } else {
                state = 'DOWN';
                stateTimer = 1500;
                message = 'DOWN!!';
            }
        }
    }

    // ---------- state machine transitions ----------
    function updateState(dt) {
        if (stateTimer > 0) {
            stateTimer -= dt;
        }
        switch (state) {
            case 'TITLE':
                if (justPressed.has('Enter')) { state = 'SELECT'; selectedIndex = 0; }
                break;
            case 'SELECT':
                if (justPressed.has('ArrowUp')) selectedIndex = (selectedIndex + OPPONENTS.length - 1) % OPPONENTS.length;
                if (justPressed.has('ArrowDown')) selectedIndex = (selectedIndex + 1) % OPPONENTS.length;
                if (justPressed.has('Enter')) startMatch(selectedIndex);
                break;
            case 'READY':
                if (stateTimer <= 0) state = 'FIGHT';
                break;
            case 'FIGHT':
                break;
            case 'DOWN':
                if (stateTimer <= 0) {
                    player.hp = player.maxHp;
                    player.action = 'idle';
                    player.busyTimer = 0;
                    state = 'FIGHT';
                }
                break;
            case 'ROUND_WIN':
                if (stateTimer <= 0) {
                    if (defeated.every(Boolean)) {
                        state = 'GAME_CLEAR';
                        stateTimer = 3000;
                        message = 'ALL CLEAR!!';
                    } else {
                        state = 'SELECT';
                        selectedIndex = defeated.findIndex((d) => !d);
                        if (selectedIndex < 0) selectedIndex = 0;
                    }
                }
                break;
            case 'GAME_OVER':
                if (stateTimer <= 0 && justPressed.has('Enter')) {
                    state = 'TITLE';
                }
                break;
            case 'GAME_CLEAR':
                if (stateTimer <= 0 && justPressed.has('Enter')) {
                    state = 'TITLE';
                }
                break;
        }
        if (state === 'TITLE') {
            lives = MAX_LIVES;
            defeated = [false, false, false];
        }
    }

    // ---------- drawing ----------
    function drawRing() {
        ctx.fillStyle = '#1a2438';
        ctx.fillRect(0, 0, W, H);

        // floor
        const grad = ctx.createLinearGradient(0, GROUND_Y, 0, H);
        grad.addColorStop(0, '#3a3560');
        grad.addColorStop(1, '#221d3d');
        ctx.fillStyle = grad;
        ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

        // ropes
        ctx.strokeStyle = '#e5395b';
        ctx.lineWidth = 4;
        for (const ry of [GROUND_Y - 220, GROUND_Y - 160, GROUND_Y - 100]) {
            ctx.beginPath();
            ctx.moveTo(0, ry);
            ctx.lineTo(W, ry);
            ctx.stroke();
        }
        // corner posts
        ctx.fillStyle = '#c62b47';
        ctx.fillRect(10, GROUND_Y - 240, 14, 240);
        ctx.fillRect(W - 24, GROUND_Y - 240, 14, 240);

        // ground line
        ctx.fillStyle = '#0e0c1c';
        ctx.fillRect(0, GROUND_Y, W, 4);
    }

    function drawFighter(f, isPlayer) {
        const facing = isPlayer ? 1 : -1;
        let ox = 0, oy = 0, lean = 0;
        let armL = -18, armR = 18; // forward offset of each glove relative to body center

        if (f.action === 'dodgeL') { ox = -22 * facing; lean = -0.12 * facing; }
        else if (f.action === 'dodgeR') { ox = 22 * facing; lean = 0.12 * facing; }
        else if (f.action === 'block') { oy = 14; }
        else if (f.action === 'punchL') { armL = 46; }
        else if (f.action === 'punchR') { armR = -46; }
        else if (f.action === 'special') { armR = -70; armL = -30; }
        else if (f.action === 'hitstun') { ox = -10 * facing; }
        else if (f.action === 'down') { oy = 40; }

        // enemy-specific attack pose
        if (!isPlayer) {
            if (f.phase === 'telegraph') {
                const t = 1 - f.timer / f.def.telegraph;
                if (f.attackType === 'hookL') armL = -18 - 30 * t;
                if (f.attackType === 'hookR') armR = 18 + 30 * t;
                if (f.attackType === 'body') oy = 10 * t;
            } else if (f.phase === 'active') {
                if (f.attackType === 'hookL') armL = -80;
                if (f.attackType === 'hookR') armR = 80;
                if (f.attackType === 'body') { oy = 16; armL = -50; armR = 50; }
            } else if (f.phase === 'rest') {
                oy = -6;
            }
        }

        const cx = f.x + ox;
        const cy = f.y + oy;
        const bodyColor = isPlayer ? '#3a7bd5' : f.def.color;
        const darkColor = isPlayer ? '#1d3f73' : f.def.dark;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(lean * facing);

        const flashing = f.hitFlash > 0 && Math.floor(f.hitFlash / 60) % 2 === 0;

        // shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 6, 34, 9, 0, 0, Math.PI * 2);
        ctx.fill();

        // legs
        ctx.fillStyle = darkColor;
        ctx.fillRect(-20, -70, 14, 70);
        ctx.fillRect(6, -70, 14, 70);

        // torso
        ctx.fillStyle = flashing ? '#ffffff' : bodyColor;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-26, -150, 52, 90, 10) : ctx.rect(-26, -150, 52, 90);
        ctx.fill();

        // head
        ctx.beginPath();
        ctx.arc(0, -170, 20, 0, Math.PI * 2);
        ctx.fillStyle = flashing ? '#ffffff' : '#e8b98a';
        ctx.fill();

        // guard glove (rear arm, near face) unless punching with it
        ctx.fillStyle = flashing ? '#ffffff' : darkColor;
        if (f.action !== 'block') {
            ctx.beginPath();
            ctx.arc(-8, -155, 11, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(-10, -110, 12, 0, Math.PI * 2);
            ctx.arc(10, -110, 12, 0, Math.PI * 2);
            ctx.fill();
        }

        // left glove (extends by armL, negative = toward own body/back, positive = forward)
        ctx.beginPath();
        ctx.arc(armL * facing, -140, 13, 0, Math.PI * 2);
        ctx.fillStyle = flashing ? '#ffffff' : '#222';
        ctx.fill();
        ctx.strokeStyle = darkColor;
        ctx.lineWidth = 3;
        ctx.stroke();

        // right glove
        ctx.beginPath();
        ctx.arc(armR * facing, -140, 13, 0, Math.PI * 2);
        ctx.fillStyle = flashing ? '#ffffff' : '#222';
        ctx.fill();
        ctx.stroke();

        ctx.restore();

        // telegraph direction indicator above enemy head
        if (!isPlayer && f.phase === 'telegraph') {
            const alpha = clamp(1 - f.timer / f.def.telegraph + 0.25, 0.25, 1);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ffd23f';
            ctx.font = 'bold 30px monospace';
            ctx.textAlign = 'center';
            let glyph = '?';
            if (f.attackType === 'hookL') glyph = '◀'; // ◀ dodge left
            if (f.attackType === 'hookR') glyph = '▶'; // ▶ dodge right
            if (f.attackType === 'body') glyph = '▼'; // ▼ block
            ctx.fillText(glyph, f.x, f.y - 210);
            ctx.restore();
        }
        if (!isPlayer && f.phase === 'rest') {
            ctx.save();
            ctx.fillStyle = '#ffd23f';
            ctx.font = 'bold 16px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('OPEN!', f.x, f.y - 210);
            ctx.restore();
        }
    }

    function drawCenterText(lines, opts = {}) {
        const size = opts.size || 42;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        lines.forEach((line, i) => {
            ctx.font = `bold ${i === 0 ? size : size * 0.45}px monospace`;
            ctx.fillStyle = i === 0 ? '#ffd23f' : '#ffffff';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 5;
            const y = H / 2 + i * (size * 0.6) - (lines.length - 1) * size * 0.3;
            ctx.strokeText(line, W / 2, y);
            ctx.fillText(line, W / 2, y);
        });
        ctx.restore();
    }

    function draw() {
        drawRing();

        if (state === 'FIGHT' || state === 'READY' || state === 'DOWN' || state === 'ROUND_WIN') {
            drawFighter(enemy, false);
            drawFighter(player, true);
        }

        switch (state) {
            case 'TITLE':
                drawCenterText(['PUNCH FIGHTER', 'Press ENTER to Start'], { size: 54 });
                break;
            case 'SELECT':
                drawSelectScreen();
                break;
            case 'READY':
                drawCenterText([message, 'Ready...']);
                break;
            case 'DOWN':
                drawCenterText(['DOWN!!', 'get up...'], { size: 50 });
                break;
            case 'ROUND_WIN':
                drawCenterText([message]);
                break;
            case 'GAME_OVER':
                drawCenterText(['GAME OVER', 'Press ENTER for Title'], { size: 54 });
                break;
            case 'GAME_CLEAR':
                drawCenterText(['ALL CLEAR!!', 'You are the Champion!', 'Press ENTER for Title'], { size: 48 });
                break;
        }
    }

    function drawSelectScreen() {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd23f';
        ctx.font = 'bold 30px monospace';
        ctx.fillText('CHOOSE YOUR OPPONENT', W / 2, 70);
        ctx.font = '16px monospace';
        ctx.fillStyle = '#ccc';
        ctx.fillText('↑ ↓ to select   ENTER to fight', W / 2, 100);

        OPPONENTS.forEach((o, i) => {
            const y = 170 + i * 70;
            const active = i === selectedIndex;
            ctx.fillStyle = active ? 'rgba(255,210,63,0.18)' : 'rgba(255,255,255,0.04)';
            ctx.fillRect(W / 2 - 260, y - 30, 520, 56);
            if (active) {
                ctx.strokeStyle = '#ffd23f';
                ctx.lineWidth = 3;
                ctx.strokeRect(W / 2 - 260, y - 30, 520, 56);
            }
            ctx.beginPath();
            ctx.fillStyle = o.color;
            ctx.arc(W / 2 - 220, y - 2, 20, 0, Math.PI * 2);
            ctx.fill();

            ctx.textAlign = 'left';
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 22px monospace';
            ctx.fillText(o.name, W / 2 - 180, y + 6);
            ctx.textAlign = 'right';
            ctx.font = 'bold 18px monospace';
            ctx.fillStyle = defeated[i] ? '#4be04b' : '#aaa';
            ctx.fillText(defeated[i] ? 'DEFEATED' : `HP ${o.maxHP}`, W / 2 + 250, y + 6);
            ctx.textAlign = 'center';
        });
        ctx.restore();
    }

    // ---------- HUD ----------
    function updateHud() {
        const inFight = state === 'FIGHT' || state === 'READY' || state === 'DOWN' || state === 'ROUND_WIN';
        hud.style.display = inFight ? 'flex' : 'none';
        if (!inFight) return;

        el.playerName.textContent = 'YOU';
        el.enemyName.textContent = enemy.def.name;
        el.playerHP.style.width = `${clamp((player.hp / player.maxHp) * 100, 0, 100)}%`;
        el.enemyHP.style.width = `${clamp((enemy.hp / enemy.maxHp) * 100, 0, 100)}%`;
        el.playerLives.textContent = '♥ '.repeat(Math.max(lives, 0)).trim() || '-';

        let starStr = '';
        for (let i = 0; i < MAX_STARS; i++) starStr += i < stars ? '★' : '☆';
        el.stars.innerHTML = `<span class="${stars >= MAX_STARS ? 'lit' : ''}">${starStr}</span>`;
    }

    // ---------- main loop ----------
    let lastTime = performance.now();
    function loop(now) {
        let dt = now - lastTime;
        lastTime = now;
        dt = clamp(dt, 0, 50);

        updateState(dt);
        updatePlayer(dt);
        updateOpponent(dt);
        draw();
        updateHud();

        justPressed.clear();
        requestAnimationFrame(loop);
    }

    // init
    lives = MAX_LIVES;
    player = newPlayer();
    enemy = newEnemy(OPPONENTS[0]);
    requestAnimationFrame(loop);
})();
