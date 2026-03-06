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
// C++ actions connect here to send messages back into chat
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

    // C++ actions — strip ! so "!time" matches action named "time"
    const actionKey = command.startsWith('!') ? command.slice(1) : command;
    if (actions[actionKey]) {
        const reactorMsg = `COMMAND:${actionKey}:${username}:${message}:${args}`;
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