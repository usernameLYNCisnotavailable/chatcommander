#include <iostream>
#include <string>
#include <winsock2.h>
#include <ws2tcpip.h>

#pragma comment(lib, "ws2_32.lib")

void handleCommand(const std::string& command) {
    if (command == "!hello") {
        std::cout << "Someone said hello in chat!" << std::endl;
    }
    else if (command == "!so") {
        std::cout << "Shoutout command fired!" << std::endl;
    }
}

int main() {
    WSADATA wsaData;
    int wsaInit = WSAStartup(MAKEWORD(2, 2), &wsaData);
    if (wsaInit != 0) {
        std::cout << "WSAStartup failed: " << wsaInit << std::endl;
        return 1;
    }

    SOCKET server = socket(AF_INET, SOCK_STREAM, 0);
    if (server == INVALID_SOCKET) {
        std::cout << "Socket failed: " << WSAGetLastError() << std::endl;
        return 1;
    }

    // allow port reuse
    int opt = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, (char*)&opt, sizeof(opt));

    sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_port = htons(9000);
    addr.sin_addr.s_addr = INADDR_ANY;

    if (bind(server, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        std::cout << "Bind failed: " << WSAGetLastError() << std::endl;
        return 1;
    }

    if (listen(server, 5) == SOCKET_ERROR) {
        std::cout << "Listen failed: " << WSAGetLastError() << std::endl;
        return 1;
    }

    std::cout << "C++ Reactor is running on port 9000..." << std::endl;
    std::cout << "Waiting for commands from the bot..." << std::endl;

    while (true) {
        SOCKET client = accept(server, nullptr, nullptr);
        if (client == INVALID_SOCKET) {
            std::cout << "Accept failed: " << WSAGetLastError() << std::endl;
            continue;
        }

        char buffer[1024] = {};
        int bytesReceived = recv(client, buffer, sizeof(buffer), 0);
        
        if (bytesReceived > 0) {
            std::string command(buffer, bytesReceived);
            std::cout << "Command received: " << command << std::endl;
            handleCommand(command);
        }

        closesocket(client);
    }

    WSACleanup();
    return 0;
}