const tmi = require('tmi.js');
const fs = require('fs');
const net = require('net');

function sendToReactor(command) {
    const socket = new net.Socket();
    socket.connect(9000, '127.0.0.1', () => {
        socket.write(command);
        socket.destroy();
    });
    socket.on('error', () => {
        // reactor not running, no problem
    });
}
// load your commands from commands.json
function getCommands() {
    return JSON.parse(fs.readFileSync('./commands.json', 'utf8'));
}

// bot config — 
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

const client = new tmi.Client({
    identity: {
        username: config.botUsername,
        password: config.token
    },
    channels: [config.channel]
});

client.connect();

// when someone types in chat
client.on('message', (channel, tags, message, self) => {
    if (self) return; // ignore the bot talking to itself

    const msg = message.trim().toLowerCase();
    const username = tags['display-name'];

    console.log(`${username}: ${message}`);

    // check if message matches a command
 const commands = getCommands();
if (commands[msg]) {
    client.say(channel, commands[msg].response);
    sendToReactor(msg);
}

    // built in shoutout command
    if (msg.startsWith('!so ') || msg.startsWith('!shoutout ')) {
        const target = msg.split(' ')[1];
        client.say(channel, `🔥 Go check out ${target} over at twitch.tv/${target} !`);
    }

    // built in commands list
    if (msg === '!commands') {
        const list = Object.keys(commands).join(' | ');
        client.say(channel, `Commands: ${list} | !so | !commands`);
    }
});

console.log('ChatCommander is running...');