#include <iostream>
#include <string>
#include <sstream>
#include <fstream>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

#pragma comment(lib, "ws2_32.lib")

std::string getJsonField(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos = json.find(":", pos);
    if (pos == std::string::npos) return "";
    pos++;
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    if (json[pos] == '"') {
        pos++;
        std::string val;
        while (pos < json.size() && json[pos] != '"') {
            if (json[pos] == '\\') pos++;
            val += json[pos++];
        }
        return val;
    }
    std::string val;
    while (pos < json.size() && json[pos] != ',' && json[pos] != '}') {
        val += json[pos++];
    }
    while (!val.empty() && (val.back() == ' ' || val.back() == '\t')) val.pop_back();
    return val;
}

std::string getActionsDir() {
    char path[MAX_PATH];
    GetModuleFileNameA(NULL, path, MAX_PATH);
    std::string dir(path);
    size_t pos = dir.find_last_of("\\/");
    if (pos != std::string::npos) dir = dir.substr(0, pos);
    return dir + "\\actions";
}

std::string compileAction(const std::string& actionName, const std::string& code) {
    std::string actionsDir = getActionsDir();
    CreateDirectoryA(actionsDir.c_str(), NULL);

    std::string srcPath = actionsDir + "\\" + actionName + ".cpp";
    std::string exePath = actionsDir + "\\" + actionName + ".exe";

    std::ofstream src(srcPath);
    if (!src.is_open()) return "ERROR: Could not write source file";

   src << "#include <iostream>\n";
src << "#include <string>\n";
src << "#include <windows.h>\n";
src << "#include <winsock2.h>\n";
src << "#include <cstdlib>\n";
src << "#include <ctime>\n";
src << "#include <sstream>\n\n";
    src << "int main(int argc, char* argv[]) {\n";
    src << "    std::string username = argc > 1 ? argv[1] : \"\";\n";
    src << "    std::string message  = argc > 2 ? argv[2] : \"\";\n";
    src << "    std::string args     = argc > 3 ? argv[3] : \"\";\n\n";
    src << "    // --- YOUR CODE ---\n";
    src << code << "\n";
    src << "    // --- END ---\n";
    src << "    return 0;\n";
    src << "}\n";
    src.close();

    std::string cmd = "g++ \"" + srcPath + "\" -o \"" + exePath + "\" -lws2_32 2>&1";

    FILE* pipe = _popen(cmd.c_str(), "r");
    if (!pipe) return "ERROR: Could not run g++";

    std::string result;
    char buf[256];
    while (fgets(buf, sizeof(buf), pipe)) {
        result += buf;
    }
    int exitCode = _pclose(pipe);

    if (exitCode == 0) {
        return "OK";
    } else {
        return "COMPILE_ERROR:" + result;
    }
}

void runAction(const std::string& actionName, const std::string& username,
               const std::string& message, const std::string& args) {
    std::string exePath = getActionsDir() + "\\" + actionName + ".exe";

    if (GetFileAttributesA(exePath.c_str()) == INVALID_FILE_ATTRIBUTES) {
        std::cout << "[reactor] Action exe not found: " << exePath << std::endl;
        return;
    }

    std::string cmd = "\"" + exePath + "\" \"" + username + "\" \"" + message + "\" \"" + args + "\"";

    STARTUPINFOA si = {};
    PROCESS_INFORMATION pi = {};
    si.cb = sizeof(si);

    if (CreateProcessA(NULL, (LPSTR)cmd.c_str(), NULL, NULL, FALSE,
                       CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        WaitForSingleObject(pi.hProcess, 5000);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        std::cout << "[reactor] Action ran: " << actionName << std::endl;
    } else {
        std::cout << "[reactor] Failed to run action: " << actionName << std::endl;
    }
}

// client socket passed in so COMPILE can send result back
void handleMessage(const std::string& raw, SOCKET client) {
    if (raw.size() >= 8 && raw.substr(0, 8) == "COMPILE:") {
        size_t p1 = raw.find(':', 8);
        if (p1 == std::string::npos) {
            std::string err = "COMPILE_RESULT:COMPILE_ERROR:Bad format";
            send(client, err.c_str(), (int)err.size(), 0);
            return;
        }
        std::string name = raw.substr(8, p1 - 8);
        std::string code = raw.substr(p1 + 1);
        std::cout << "[reactor] Compiling action: " << name << std::endl;
        std::string result = compileAction(name, code);
        std::string response = "COMPILE_RESULT:" + result;
        send(client, response.c_str(), (int)response.size(), 0);
        std::cout << "[reactor] Compile result: " << result << std::endl;
    }
    else if (raw.size() >= 4 && raw.substr(0, 4) == "RUN:") {
        std::string rest = raw.substr(4);
        std::stringstream ss(rest);
        std::string name, username, message, args;
        std::getline(ss, name, ':');
        std::getline(ss, username, ':');
        std::getline(ss, message, ':');
        std::getline(ss, args);
        runAction(name, username, message, args);
    }
    else if (raw.size() >= 8 && raw.substr(0, 8) == "COMMAND:") {
        std::string rest = raw.substr(8);
        std::stringstream ss(rest);
        std::string command, username, message, args;
        std::getline(ss, command, ':');
        std::getline(ss, username, ':');
        std::getline(ss, message, ':');
        std::getline(ss, args);
        std::cout << "[reactor] Chat command: " << command
                  << " from " << username << std::endl;
        runAction(command, username, message, args);
    }
    else {
        std::cout << "[reactor] Legacy command: " << raw << std::endl;
    }
}

int main() {
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);

    SOCKET server = socket(AF_INET, SOCK_STREAM, 0);
    int opt = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, (char*)&opt, sizeof(opt));

    sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_port = htons(9000);
    addr.sin_addr.s_addr = INADDR_ANY;

    bind(server, (sockaddr*)&addr, sizeof(addr));
    listen(server, 5);

    std::cout << "C++ Reactor is running on port 9000..." << std::endl;
    std::cout << "Actions directory: " << getActionsDir() << std::endl;

    while (true) {
        SOCKET client = accept(server, nullptr, nullptr);
        if (client == INVALID_SOCKET) continue;

        std::string fullMsg;
        char buf[4096];
        int bytes;
        while ((bytes = recv(client, buf, sizeof(buf) - 1, 0)) > 0) {
            buf[bytes] = '\0';
            fullMsg += buf;
            if (bytes < (int)sizeof(buf) - 1) break;
        }

        if (!fullMsg.empty()) {
            handleMessage(fullMsg, client);
        }

        closesocket(client);
    }

    WSACleanup();
    return 0;
}