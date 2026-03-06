const tmi = require('tmi.js');
const fs = require('fs');
const net = require('net');
const path = require('path');

const dataDir = process.env.CHATCOMMANDER_DATA_PATH || '.';

function sendToReactor(message) {
    const socket = new net.Socket();
    socket.connect(9000, '127.0.0.1', () => {
        socket.write(message);
        socket.destroy();
    });
    socket.on('error', () => {});
}

function getCommands() {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'commands.json'), 'utf8'));
}

function getActions() {
    const actionsPath = path.join(dataDir, 'actions.json');
    if (!fs.existsSync(actionsPath)) return {};
    return JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
}

const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));

const client = new tmi.Client({
    identity: {
        username: config.botUsername,
        password: config.token
    },
    channels: [config.channel]
});

client.connect().catch(err => {
    console.error('Bot connection failed:', err);
});

// ---- Reply listener on port 9001 ----
const replyServer = net.createServer((socket) => {
    let data = '';
    socket.on('data', (chunk) => { data += chunk.toString(); });
    socket.on('end', () => {
        const msg = data.trim();
        if (msg) {
            console.log('[bot] Reply from action:', msg);
            client.say('#' + config.channel.replace('#', ''), msg);
        }
    });
    socket.on('error', () => {});
});

replyServer.listen(9001, '127.0.0.1', () => {
    console.log('Bot reply listener running on port 9001');
});

// ---- Auto $50/hr bank bonus ----
function giveHourlyBonus() {
    const memPath = path.join(dataDir, 'memory.json');
    if (!fs.existsSync(memPath)) return;

    let mem = {};
    try { mem = JSON.parse(fs.readFileSync(memPath, 'utf8')); } catch(e) { return; }

    let changed = false;
    for (const key of Object.keys(mem)) {
        if (key.startsWith('bank_')) {
            const user = key.slice(5);
            const current = parseInt(mem[key]) || 0;
            mem[key] = String(current + 50);
            changed = true;
            console.log(`[bank] Hourly bonus +$50 to ${user} (bank: ${mem[key]})`);
        }
    }

    if (changed) {
        fs.writeFileSync(memPath, JSON.stringify(mem, null, 4));
    }
}

// Run 1 minute after bot starts, then every hour
setTimeout(() => {
    giveHourlyBonus();
    setInterval(giveHourlyBonus, 60 * 60 * 1000);
}, 60 * 1000);

// ---- Chat handler ----
client.on('message', (channel, tags, message, self) => {
    if (self) return;

    const msg = message.trim().toLowerCase();
    const username = tags['display-name'] || tags.username || '';
    const command = msg.split(' ')[0];
    const args = msg.split(' ').slice(1).join(' ');

    console.log(`${username}: ${message}`);

    const commands = getCommands();
    const actions = getActions();

    // Text commands
    if (commands[command]) {
        client.say(channel, commands[command].response);
    }

    // C++ actions — only trigger if message starts with !
    const actionKey = command.startsWith('!') ? command.slice(1) : null;
    if (actionKey && actions[actionKey]) {
        const reactorMsg = `COMMAND:${actionKey}:${username}:${message}:${args}:${config.channel}`;
        sendToReactor(reactorMsg);
    }

    // Built in shoutout
    if (msg.startsWith('!so ') || msg.startsWith('!shoutout ')) {
        const target = msg.split(' ')[1];
        client.say(channel, `🔥 Go check out ${target} over at twitch.tv/${target} !`);
    }

    // Built in commands list
    if (msg === '!commands') {
        const allCommands = [
            ...Object.keys(commands),
            ...Object.keys(actions).map(a => '!' + a),
            '!so', '!commands'
        ];
        const unique = [...new Set(allCommands)];
        client.say(channel, `Commands: ${unique.join(' | ')}`);
    }
});

console.log('ChatCommander is running...');