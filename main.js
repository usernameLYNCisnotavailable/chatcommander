const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let botProcess = null;
let reactorProcess = null;

function getDataPath(file) {
    const userDataPath = app.getPath('userData');
    const filePath = path.join(userDataPath, file);
    if (!fs.existsSync(filePath)) {
        const defaultPath = path.join(__dirname, file);
        if (fs.existsSync(defaultPath)) {
            fs.copyFileSync(defaultPath, filePath);
        }
    }
    return filePath;
}

function startReactor() {
    const reactorPath = app.isPackaged
        ? path.join(process.resourcesPath, 'reactor.exe')
        : path.join(__dirname, 'reactor.exe');

    if (!fs.existsSync(reactorPath)) {
        console.log('reactor.exe not found at:', reactorPath);
        return;
    }

    reactorProcess = spawn(reactorPath, [], {
        cwd: path.dirname(reactorPath),
        stdio: 'pipe'
    });

    reactorProcess.stdout.on('data', (data) => {
        console.log('[reactor]', data.toString().trim());
    });

    reactorProcess.stderr.on('data', (data) => {
        console.error('[reactor error]', data.toString().trim());
    });

    reactorProcess.on('exit', (code) => {
        console.log('[reactor] exited with code', code);
        reactorProcess = null;
    });

    console.log('Reactor started.');
}

function startBot() {
    console.log('startBot called');
    const botPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar', 'index.js')
        : path.join(__dirname, 'index.js');

    const userDataPath = app.getPath('userData');

    getDataPath('config.json');
    getDataPath('commands.json');

    const config = JSON.parse(fs.readFileSync(path.join(userDataPath, 'config.json'), 'utf8'));
console.log('Config at startBot:', JSON.stringify(config));
    if (!config.setupComplete) {
        console.log('Setup not complete, bot will not start yet.');
        return;
    }

    botProcess = spawn(process.execPath, [botPath], {
        env: {
            ...process.env,
            CHATCOMMANDER_DATA_PATH: userDataPath
        },
        stdio: 'pipe'
    });

    botProcess.stdout.on('data', (data) => {
        console.log('[bot]', data.toString().trim());
    });

    botProcess.stderr.on('data', (data) => {
        console.error('[bot error]', data.toString().trim());
    });

    botProcess.on('exit', (code) => {
        console.log('[bot] exited with code', code);
        botProcess = null;
    });

    console.log('Bot started.');
}

function startServer() {
    const express = require('express');
    const axios = require('axios');
    const net = require('net');
    const appDir = __dirname;

    const server = express();
    server.use(express.json({ limit: '10mb' }));

    // ---- PAGES ----
    server.get('/test', (req, res) => res.send('working'));

    server.get('/', (req, res) => {
        const config = JSON.parse(fs.readFileSync(getDataPath('config.json'), 'utf8'));
        if (!config.setupComplete) {
            res.redirect('/setup');
        } else {
            res.sendFile(path.join(appDir, 'dashboard/index.html'));
        }
    });

    server.get('/setup', (req, res) => {
        res.sendFile(path.join(appDir, 'setup.html'));
    });

    // ---- AUTH ----
    server.get('/auth/twitch', (req, res) => {
        const url = `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.TWITCH_REDIRECT_URI)}&response_type=code&scope=chat:read+chat:edit`;
        res.redirect(url);
    });

    server.get('/auth/callback', async (req, res) => {
        const code = req.query.code;
        try {
            const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
                params: {
                    client_id: process.env.TWITCH_CLIENT_ID,
                    client_secret: process.env.TWITCH_CLIENT_SECRET,
                    code,
                    grant_type: 'authorization_code',
                    redirect_uri: process.env.TWITCH_REDIRECT_URI
                }
            });
            const accessToken = response.data.access_token;
            const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Client-Id': process.env.TWITCH_CLIENT_ID
                }
            });
            const botUsername = userResponse.data.data[0].login;
            const config = JSON.parse(fs.readFileSync(getDataPath('config.json'), 'utf8'));
            config.token = `oauth:${accessToken}`;
            config.botUsername = botUsername;
            fs.writeFileSync(getDataPath('config.json'), JSON.stringify(config, null, 4));
            res.redirect('/setup?authenticated=true');
        } catch (err) {
            console.error(err);
            res.send('Authentication failed. Please try again.');
        }
    });

    // ---- SETUP ----
    server.post('/api/setup', (req, res) => {
        const { botUsername, token, channel, setupComplete } = req.body;
        const config = { botUsername, token, channel, setupComplete };
        fs.writeFileSync(getDataPath('config.json'), JSON.stringify(config, null, 4));
        if (setupComplete && !botProcess) {
            setTimeout(startBot, 1000);
        }
        res.json({ success: true });
    });

    server.get('/api/config', (req, res) => {
        const config = JSON.parse(fs.readFileSync(getDataPath('config.json'), 'utf8'));
        res.json(config);
    });

    // ---- COMMANDS ----
    server.get('/api/commands', (req, res) => {
        const commands = JSON.parse(fs.readFileSync(getDataPath('commands.json'), 'utf8'));
        res.json(commands);
    });

    server.post('/api/commands', (req, res) => {
        const { command, response } = req.body;
        const commands = JSON.parse(fs.readFileSync(getDataPath('commands.json'), 'utf8'));
        commands[command] = { response };
        fs.writeFileSync(getDataPath('commands.json'), JSON.stringify(commands, null, 4));
        res.json({ success: true });
    });

    server.delete('/api/commands/:command', (req, res) => {
        const command = decodeURIComponent(req.params.command);
        const commands = JSON.parse(fs.readFileSync(getDataPath('commands.json'), 'utf8'));
        delete commands[command];
        fs.writeFileSync(getDataPath('commands.json'), JSON.stringify(commands, null, 4));
        res.json({ success: true });
    });

    // ---- BOT STATUS ----
    server.get('/api/bot-status', (req, res) => {
        res.json({ running: botProcess !== null });
    });

    server.post('/api/bot-start', (req, res) => {
        if (botProcess) return res.json({ success: false, message: 'Bot already running' });
        startBot();
        res.json({ success: true });
    });

    server.post('/api/bot-stop', (req, res) => {
        if (botProcess) {
            botProcess.kill();
            botProcess = null;
        }
        res.json({ success: true });
    });

    // ---- ACTIONS ----
    server.get('/api/actions', (req, res) => {
        const p = getDataPath('actions.json');
        if (!fs.existsSync(p)) fs.writeFileSync(p, '{}');
        res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
    });

    server.post('/api/actions/compile', (req, res) => {
        const { name, code } = req.body;
        const socket = new net.Socket();
        let result = '';
        socket.connect(9000, '127.0.0.1', () => {
            socket.write(`COMPILE:${name}:${code}`);
        });
        socket.on('data', (data) => { result += data.toString(); });
        socket.on('close', () => {
            const p = getDataPath('actions.json');
            const actions = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (actions[name]) {
                const success = result.includes('COMPILE_RESULT:OK');
                actions[name].compiled = success;
                actions[name].code = code;
                fs.writeFileSync(p, JSON.stringify(actions, null, 4));
                if (success) {
                    res.json({ success: true });
                } else {
                    const err = result.replace('COMPILE_RESULT:', '').replace('COMPILE_ERROR:', '');
                    res.json({ success: false, error: err });
                }
            } else {
                res.json({ success: false, error: 'Action not found' });
            }
        });
        socket.on('error', () => {
            res.json({ success: false, error: 'Reactor not running' });
        });
    });

    server.post('/api/actions/run', (req, res) => {
        const { name, username, message, args } = req.body;
        const socket = new net.Socket();
        socket.connect(9000, '127.0.0.1', () => {
            socket.write(`RUN:${name}:${username}:${message}:${args}`);
            socket.destroy();
        });
        socket.on('error', () => {});
        res.json({ success: true });
    });

    server.post('/api/actions', (req, res) => {
        const { name, trigger, code, compiled } = req.body;
        const p = getDataPath('actions.json');
        if (!fs.existsSync(p)) fs.writeFileSync(p, '{}');
        const actions = JSON.parse(fs.readFileSync(p, 'utf8'));
        actions[name] = { trigger, code, compiled: false };
        fs.writeFileSync(p, JSON.stringify(actions, null, 4));
        res.json({ success: true });
    });

    server.put('/api/actions/:name', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const { code } = req.body;
        const p = getDataPath('actions.json');
        const actions = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (actions[name]) actions[name].code = code;
        fs.writeFileSync(p, JSON.stringify(actions, null, 4));
        res.json({ success: true });
    });

    server.delete('/api/actions/:name', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const p = getDataPath('actions.json');
        const actions = JSON.parse(fs.readFileSync(p, 'utf8'));
        delete actions[name];
        fs.writeFileSync(p, JSON.stringify(actions, null, 4));
        res.json({ success: true });
    });

    // ---- GROUPS ----
    server.get('/api/groups', (req, res) => {
        const p = getDataPath('groups.json');
        if (!fs.existsSync(p)) fs.writeFileSync(p, '{}');
        res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
    });

    server.post('/api/groups', (req, res) => {
        const { name, actions } = req.body;
        const p = getDataPath('groups.json');
        if (!fs.existsSync(p)) fs.writeFileSync(p, '{}');
        const groups = JSON.parse(fs.readFileSync(p, 'utf8'));
        groups[name] = { actions: actions || [] };
        fs.writeFileSync(p, JSON.stringify(groups, null, 4));
        res.json({ success: true });
    });

    server.put('/api/groups/:name', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const p = getDataPath('groups.json');
        const groups = JSON.parse(fs.readFileSync(p, 'utf8'));
        groups[name] = req.body;
        fs.writeFileSync(p, JSON.stringify(groups, null, 4));
        res.json({ success: true });
    });

    server.delete('/api/groups/:name', (req, res) => {
        const name = decodeURIComponent(req.params.name);
        const p = getDataPath('groups.json');
        const groups = JSON.parse(fs.readFileSync(p, 'utf8'));
        delete groups[name];
        fs.writeFileSync(p, JSON.stringify(groups, null, 4));
        res.json({ success: true });
    });

    // ---- STATIC (must be last) ----
    server.use(express.static(path.join(appDir, 'dashboard')));

    server.listen(3000, () => {
        console.log('Server running on port 3000');
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        backgroundColor: '#020408',
        title: 'ChatCommander',
        center: true,
        frame: true
    });

    setTimeout(() => {
        mainWindow.loadURL('http://localhost:3000');
    }, 1500);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    require('dotenv').config({
        path: app.isPackaged
            ? path.join(process.resourcesPath, '.env')
            : path.join(__dirname, '.env')
    });
    startServer();
    startReactor();
    startBot();
    createWindow();
});

app.on('window-all-closed', () => {
    if (botProcess) botProcess.kill();
    if (reactorProcess) reactorProcess.kill();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});