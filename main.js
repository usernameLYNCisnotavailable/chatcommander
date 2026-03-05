const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let dashboardProcess;

function startDashboard() {
    dashboardProcess = spawn('node', ['dashboard.js'], {
        cwd: __dirname,
        stdio: 'inherit'
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

    // wait for dashboard server to start then load it
    setTimeout(() => {
        mainWindow.loadURL('http://localhost:3000');
    }, 1500);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    startDashboard();
    createWindow();
});

app.on('window-all-closed', () => {
    if (dashboardProcess) dashboardProcess.kill();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});