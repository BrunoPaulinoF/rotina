# Rotina Desktop

Assistente visual de rotina pessoal para Windows 10/11. Mostra a atividade atual, a próxima, contagem regressiva, e emite alertas sonoros e notificações nas transições. Funciona 100% offline.

## Uso

- **Instalar:** execute `dist/RotinaDesktop-Setup-1.0.0.exe` (gerado por `npm run dist`).
- **Bandeja do Windows:** fechar a janela mantém o app rodando (alertas continuam). Clique com o botão direito no ícone para pausar, silenciar, adiar o último alerta, abrir a janela flutuante ou sair.
- **Janela flutuante:** arraste para mover, puxe a borda para redimensionar, use o alfinete para "sempre visível". Duplo clique abre a janela principal.
- **Configurações:** atividades, categorias e cores, alertas e sons, tarefas da semana, exceções de datas, regras/listas, inicialização com o Windows e backup.

## Desenvolvimento

```bash
npm install
node node_modules/electron/install.js   # só se o binário do Electron não tiver sido baixado
npm start                               # roda o app
npm run check                           # verificação de sintaxe
npm test                                # testes do motor, alertas e persistência
npm run dist                            # check + testes + instalador NSIS em dist/
```

Opções úteis para testar:

| Opção | Efeito |
| --- | --- |
| `--fake-now=2026-11-03T18:59:50` (ou env `ROTINA_FAKE_NOW`) | Relógio simulado para testar transições |
| `--data-dir=pasta` (ou env `ROTINA_DATA_DIR`) | Usa outra pasta de dados |
| `--hidden` | Inicia só na bandeja (é assim que o Windows abre no login) |
| `--capture=pasta --capture-exit` | Salva capturas de tela de todas as telas e sai |
| env `ROTINA_GPU=1` | Reativa a aceleração por GPU (desligada para economizar memória) |

## Estrutura

```
src/shared/engine.js   Motor de agendamento (puro): plano do dia, status, eventos, sobreposições
src/main/main.js       Processo principal: janelas, bandeja, alertas, IPC, autostart
src/main/alerts.js     Disparo de alertas: tolerância, saltos de relógio, pausa, silêncio, adiar
src/main/store.js      Persistência JSON atômica e validação da configuração
src/main/defaults.js   Rotina inicial
src/preload.js         Ponte segura entre janelas e processo principal
src/renderer/          Interface (HTML/CSS/JS puro): principal, flutuante, cartão de alerta, áudio
scripts/               Geração de ícones e verificação de sintaxe
test/                  Testes (node:test)
```

## Dados

Ficam em `%APPDATA%\Rotina Desktop\`: `config.json` (rotina e configurações), `state.json` (pausa, silêncio, alertas adiados, posição das janelas) e `rotina.log` (alertas disparados e erros). Arquivos corrompidos são preservados como `*.corrompido-<data>` e o app recomeça dos padrões.

## Regras de agendamento

- A atividade atual é a de maior prioridade entre as que estão acontecendo; empate fica com a que começou por último. Compromissos (igreja, futebol) têm prioridade e encobrem as demais.
- O início de uma atividade encoberta não gera alerta; quando o compromisso termina, um alerta "De volta: ..." indica a atividade que retoma.
- Ao ligar o computador, retomar da suspensão ou mudar o relógio, alertas que já passaram não são disparados (tolerância de 60 s).
