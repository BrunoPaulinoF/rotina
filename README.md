# Rotina Desktop

Assistente visual de rotina pessoal para Windows 10/11. Mostra a atividade atual, a próxima, contagem regressiva, e emite alertas sonoros e notificações nas transições. Funciona 100% offline.

## Uso

- **Instalar:** baixe o instalador da [última release](https://github.com/BrunoPaulinoF/rotina/releases/latest) (ou gere com `npm run dist`).
- **Bandeja do Windows:** fechar a janela mantém o app rodando (alertas continuam). Clique com o botão direito no ícone para pausar, silenciar, adiar o último alerta, abrir a janela flutuante ou sair.
- **Janela flutuante:** pílula pequena no topo central da tela com a atividade atual e o tempo restante. Duplo clique abre a janela principal; ao passar o mouse aparecem os botões abrir/ocultar. Para arrastar, desative "Fixar no topo central" em Configurações → Geral e backup.
- **Configurações:** atividades, categorias e cores, alertas e sons, tarefas da semana, exceções de datas, regras/listas, inicialização com o Windows e backup.

## Agentes de IA (Claude Cowork, Claude Code, Cursor…)

O agente consegue consultar e alterar a rotina por três caminhos, todos com a mesma validação do app (que recarrega na hora):

1. **MCP** — em Configurações → Agentes de IA: botão "Conectar ao Claude" (Claude Desktop/Cowork), comando pronto para o Claude Code e JSON para outros clientes. O servidor roda pelo próprio `RotinaDesktop.exe` (com `ELECTRON_RUN_AS_NODE=1`), sem precisar de Node.
2. **Linha de comando** — `RotinaDesktop.exe <caminho>\app.asar\src\agent\server.js --cli ajuda`; argumentos como `chave=valor` (ex.: `--cli salvar_atividade title="Academia" start=19:00 end=20:00 days=seg,qua`).
3. **Arquivo** — editar `%APPDATA%\Rotina Desktop\config.json`; o formato está em `AGENTES.md`, na mesma pasta.

Ferramentas: `ver_agora`, `ver_dia`, `ver_semana`, `listar_atividades`, `salvar_atividade`, `remover_atividade`, `listar_categorias`, `salvar_categoria`, `remover_categoria`, `definir_dia_semana`, `salvar_excecao`, `remover_excecao`, `editar_lista`, `alterar_configuracoes`, `ler_configuracao`, `substituir_configuracao`, `desfazer_ultima_alteracao`.

## Atualizações

Em Configurações → Geral e backup → **Verificar atualizações**, o app consulta a última release do GitHub e, com um clique, baixa o instalador, confere o SHA-512 (`latest.yml`) e reinstala em silêncio, reabrindo sozinho. Rotina e configurações ficam em `%APPDATA%` e são mantidas.

Para publicar uma versão nova:

```bash
# 1. aumente "version" no package.json, faça commit e push
npm run release   # gera o instalador e cria a release vX.Y.Z no GitHub (requer gh autenticado)
```

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
src/main/updater.js    Atualização pelo GitHub Releases
src/agent/             Ferramentas para agentes de IA: servidor MCP e linha de comando
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
