/*
 * BTC Radar.exe - o programa que a pessoa clica no Windows.
 *
 * Nao e o painel: e um lancador minusculo. Ele acha o Node (o que veio junto no
 * instalador ou o do sistema), sobe o server.js escondido, espera a porta responder
 * e abre o navegador. Existe porque node.exe e programa de console: chamado direto
 * pelo atalho, deixaria uma janela preta aberta o tempo todo, e fechar essa janela
 * mataria o painel sem aviso.
 *
 * Uso:
 *   "BTC Radar.exe"               sobe (se preciso) e abre o navegador
 *   "BTC Radar.exe" --silencioso  sobe sem abrir o navegador (usado na inicializacao)
 *   "BTC Radar.exe" --parar       para o painel que esta rodando em segundo plano
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <shlobj.h>
#include <shellapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "user32.lib")

#define TITULO L"BTC Radar"
#define PORTA_PADRAO 8899
#define ESPERA_MS 250
#define TENTATIVAS 120          /* 120 x 250ms = 30 segundos */

static void aviso(const wchar_t *texto, UINT icone) {
    MessageBoxW(NULL, texto, TITULO, icone | MB_OK | MB_SETFOREGROUND);
}

static int arquivo_existe(const wchar_t *p) {
    DWORD a = GetFileAttributesW(p);
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

static int pasta_existe(const wchar_t *p) {
    DWORD a = GetFileAttributesW(p);
    return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY);
}

/* Alguem ja esta escutando nessa porta em 127.0.0.1? Em loopback a recusa e
   imediata, entao nao precisa de timeout artesanal. */
static int porta_aberta(int porta) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    struct sockaddr_in end;
    int ok;
    if (s == INVALID_SOCKET) return 0;
    ZeroMemory(&end, sizeof(end));
    end.sin_family = AF_INET;
    end.sin_port = htons((u_short)porta);
    end.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    ok = connect(s, (struct sockaddr *)&end, sizeof(end)) == 0;
    closesocket(s);
    return ok;
}

static int porta_configurada(void) {
    wchar_t buf[32];
    int p;
    if (!GetEnvironmentVariableW(L"BTC_RADAR_PORT", buf, 32)) return PORTA_PADRAO;
    p = _wtoi(buf);
    return (p > 0 && p < 65536) ? p : PORTA_PADRAO;
}

/* Onde ficam historico, snapshots e a chave da IA. Instalado, vai pro perfil do
   usuario: a pasta do programa pode nao ter permissao de escrita e desinstalar
   nao pode levar junto os dados. Em pasta portatil, fica ao lado do programa. */
static void definir_pasta_de_dados(const wchar_t *dir, wchar_t *saida, size_t n) {
    wchar_t marca[MAX_PATH], local[MAX_PATH], aoLado[MAX_PATH];

    if (GetEnvironmentVariableW(L"BTC_RADAR_DATA", saida, (DWORD)n)) return;

    swprintf(marca, MAX_PATH, L"%s\\portatil.txt", dir);
    swprintf(aoLado, MAX_PATH, L"%s\\data", dir);

    if (arquivo_existe(marca) || pasta_existe(aoLado)) {
        wcscpy_s(saida, n, aoLado);
    } else if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, local))) {
        swprintf(saida, n, L"%s\\BTC Radar\\data", local);
    } else {
        wcscpy_s(saida, n, aoLado);
    }
    SHCreateDirectoryExW(NULL, saida, NULL);
    SetEnvironmentVariableW(L"BTC_RADAR_DATA", saida);
}

/* O node que veio no instalador tem prioridade sobre o do sistema: e a versao que
   sabemos que funciona. */
static int achar_node(const wchar_t *dir, wchar_t *saida, size_t n) {
    swprintf(saida, n, L"%s\\node\\node.exe", dir);
    if (arquivo_existe(saida)) return 1;
    if (SearchPathW(NULL, L"node.exe", NULL, (DWORD)n, saida, NULL)) return 1;
    return 0;
}

/* Le o pid anotado pelo servidor e confere que aquele processo ainda e um node,
   pra nunca matar um programa qualquer que herdou o mesmo numero. */
static int parar_servidor(const wchar_t *pastaDados) {
    wchar_t caminho[MAX_PATH], imagem[MAX_PATH];
    char buf[512];
    DWORD lidos = 0, tam = MAX_PATH;
    HANDLE arq, proc;
    char *marca;
    DWORD pid;
    int morreu = 0;

    swprintf(caminho, MAX_PATH, L"%s\\servidor.pid", pastaDados);
    arq = CreateFileW(caminho, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                      OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (arq == INVALID_HANDLE_VALUE) return 0;
    if (!ReadFile(arq, buf, sizeof(buf) - 1, &lidos, NULL)) lidos = 0;
    buf[lidos] = '\0';
    CloseHandle(arq);

    marca = strstr(buf, "\"pid\":");
    if (!marca) return 0;
    pid = (DWORD)strtoul(marca + 6, NULL, 10);
    if (!pid) return 0;

    proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pid);
    if (!proc) return 0;
    if (QueryFullProcessImageNameW(proc, 0, imagem, &tam)) {
        const wchar_t *nome = wcsrchr(imagem, L'\\');
        nome = nome ? nome + 1 : imagem;
        if (_wcsicmp(nome, L"node.exe") == 0) {
            morreu = TerminateProcess(proc, 0) != 0;
            if (morreu) WaitForSingleObject(proc, 5000);
        }
    }
    CloseHandle(proc);
    if (morreu) DeleteFileW(caminho);
    return morreu;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE ant, PWSTR linha, int mostrar) {
    wchar_t dir[MAX_PATH], node[MAX_PATH], servidor[MAX_PATH], dados[MAX_PATH];
    wchar_t comando[MAX_PATH * 2 + 16], url[64], erro[MAX_PATH + 512];
    WSADATA wsa;
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    LPWSTR *args;
    int qtd = 0, i, porta, silencioso = 0, parar = 0;
    DWORD saidaProc = STILL_ACTIVE;

    (void)inst; (void)ant; (void)linha; (void)mostrar;

    args = CommandLineToArgvW(GetCommandLineW(), &qtd);
    for (i = 1; args && i < qtd; i++) {
        if (_wcsicmp(args[i], L"--silencioso") == 0 || _wcsicmp(args[i], L"/silencioso") == 0) silencioso = 1;
        else if (_wcsicmp(args[i], L"--parar") == 0 || _wcsicmp(args[i], L"/parar") == 0) parar = 1;
    }
    if (args) LocalFree(args);

    GetModuleFileNameW(NULL, dir, MAX_PATH);
    { wchar_t *barra = wcsrchr(dir, L'\\'); if (barra) *barra = L'\0'; }

    definir_pasta_de_dados(dir, dados, MAX_PATH);
    porta = porta_configurada();
    swprintf(url, 64, L"http://localhost:%d", porta);

    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        aviso(L"O Windows nao deixou o BTC Radar usar a rede local.", MB_ICONERROR);
        return 1;
    }

    if (parar) {
        int estava = porta_aberta(porta);
        int ok = parar_servidor(dados);
        if (ok) aviso(L"O BTC Radar foi parado.", MB_ICONINFORMATION);
        else if (estava) aviso(L"Nao consegui parar o BTC Radar automaticamente.\n\n"
                               L"Abra o Gerenciador de Tarefas, procure por \"Node.js\" e finalize a tarefa.", MB_ICONWARNING);
        else aviso(L"O BTC Radar ja estava parado.", MB_ICONINFORMATION);
        WSACleanup();
        return ok ? 0 : 1;
    }

    /* Ja esta de pe (autostart, ou a pessoa clicou duas vezes): so abre a tela. */
    if (porta_aberta(porta)) {
        if (!silencioso) ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
        WSACleanup();
        return 0;
    }

    swprintf(servidor, MAX_PATH, L"%s\\server.js", dir);
    if (!arquivo_existe(servidor)) {
        swprintf(erro, MAX_PATH + 512,
                 L"Nao encontrei o arquivo server.js em:\n\n%s\n\n"
                 L"Instale o BTC Radar de novo, ou mantenha o programa junto dos arquivos dele.", dir);
        aviso(erro, MB_ICONERROR);
        WSACleanup();
        return 1;
    }

    if (!achar_node(dir, node, MAX_PATH)) {
        aviso(L"O motor do painel (Node.js) nao foi encontrado.\n\n"
              L"Se voce instalou pelo BTC-Radar-Setup.exe, desinstale e instale de novo.\n"
              L"Se voce baixou so o codigo, instale o Node.js 22 ou mais novo em nodejs.org "
              L"e clique aqui outra vez.", MB_ICONERROR);
        WSACleanup();
        return 1;
    }

    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    ZeroMemory(&pi, sizeof(pi));
    swprintf(comando, MAX_PATH * 2 + 16, L"\"%s\" \"%s\"", node, servidor);

    if (!CreateProcessW(node, comando, NULL, NULL, FALSE,
                        CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP,
                        NULL, dir, &si, &pi)) {
        swprintf(erro, MAX_PATH + 512, L"Nao consegui iniciar o painel usando:\n\n%s", node);
        aviso(erro, MB_ICONERROR);
        WSACleanup();
        return 1;
    }
    CloseHandle(pi.hThread);

    for (i = 0; i < TENTATIVAS; i++) {
        if (porta_aberta(porta)) break;
        if (GetExitCodeProcess(pi.hProcess, &saidaProc) && saidaProc != STILL_ACTIVE) break;
        Sleep(ESPERA_MS);
    }
    CloseHandle(pi.hProcess);

    if (!porta_aberta(porta)) {
        swprintf(erro, MAX_PATH + 512,
                 L"O painel nao subiu na porta %d.\n\n"
                 L"Para ver a mensagem de erro, abra a pasta do programa e execute "
                 L"\"BTC Radar (com janela).cmd\".\n\nPasta: %s", porta, dir);
        aviso(erro, MB_ICONERROR);
        WSACleanup();
        return 1;
    }

    if (!silencioso) ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
    WSACleanup();
    return 0;
}
