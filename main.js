const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

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

function startServer() {
    const express = require('express');
    const axios = require('axios');

   const appDir = __dirname;

    const server = express();
    server.use(express.json());

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

    server.post('/api/setup', (req, res) => {
        const { botUsername, token, channel, setupComplete } = req.body;
        const config = { botUsername, token, channel, setupComplete };
        fs.writeFileSync(getDataPath('config.json'), JSON.stringify(config, null, 4));
        res.json({ success: true });
    });

    server.get('/api/config', (req, res) => {
        const config = JSON.parse(fs.readFileSync(getDataPath('config.json'), 'utf8'));
        res.json(config);
    });

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
            ? path.join(process.resourcesPath, 'app', '.env')
            : path.join(__dirname, '.env')
    });
    startServer();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});