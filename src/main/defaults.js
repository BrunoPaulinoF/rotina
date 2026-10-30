'use strict';
/** Dados iniciais (rotina da imagem de referência). Tudo é editável nas Configurações. */

const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function act(id, start, duration, title, category, icon, extra) {
  return Object.assign(
    { id, title, subtitle: '', start, duration, days: WEEKDAYS, category, icon, priority: 0, alertStart: true, alertAdvance: true, enabled: true },
    extra || {}
  );
}

function createDefaultConfig() {
  return {
    version: 1,
    categories: [
      { id: 'trabalho', name: 'Trabalho', color: '#1F4FD1', icon: 'code' },
      { id: 'comercial', name: 'Comercial', color: '#E0405A', icon: 'briefcase' },
      { id: 'estudo', name: 'Estudo', color: '#D8457F', icon: 'book' },
      { id: 'idiomas', name: 'Inglês', color: '#F07A24', icon: 'book' },
      { id: 'comunicacao', name: 'Mensagens', color: '#6B5BE0', icon: 'mail' },
      { id: 'projetos', name: 'Projetos', color: '#17A398', icon: 'monitor' },
      { id: 'fechamento', name: 'Planejamento', color: '#6D6FE3', icon: 'flag' },
      { id: 'filho', name: 'Filho', color: '#2391EA', icon: 'car' },
      { id: 'corpo', name: 'Corpo e casa', color: '#38A649', icon: 'walk' },
      { id: 'familia', name: 'Família e descanso', color: '#0FA597', icon: 'users' },
      { id: 'compromisso', name: 'Compromissos', color: '#F59E0B', icon: 'star' },
      { id: 'basico', name: 'Básico do dia', color: '#7E93A8', icon: 'dot' },
      { id: 'sono', name: 'Sono', color: '#2B4A9B', icon: 'bed' }
    ],
    activities: [
      act('acordar', '06:40', 35, 'Acordar, me arrumar e arrumar meu filho', 'filho', 'sun'),
      act('levar-creche', '07:15', 5, 'Levar meu filho à creche', 'filho', 'car'),
      act('caminhada', '07:20', 30, 'Caminhada', 'corpo', 'walk', { subtitle: '30 min' }),
      act('cafe', '07:50', 10, 'Água e café', 'basico', 'coffee'),
      act('mensagens', '08:00', 30, 'Mensagens e e-mails', 'comunicacao', 'mail', { subtitle: 'No máximo 30 min · ler tudo, responder o urgente e anotar as tarefas do dia' }),
      act('foco1', '08:30', 120, 'Foco 1: programação', 'trabalho', 'code', { subtitle: 'Fazer a tarefa mais importante, celular no silencioso' }),
      act('estudo', '10:30', 30, 'Estudo de desenvolvimento', 'estudo', 'book', { subtitle: 'Curso, documentação, testar ferramenta ou ler artigo' }),
      act('pausa', '11:00', 20, 'Pausa: alongar e beber água', 'basico', 'stretch'),
      act('buscar-creche', '11:20', 25, 'Buscar meu filho na creche', 'filho', 'car'),
      act('almoco', '11:45', 75, 'Almoço, longe da tela', 'basico', 'utensils'),
      act('ingles', '13:00', 30, 'Inglês', 'idiomas', 'book', { subtitle: 'App, vídeo/podcast ou documentação' }),
      act('foco2', '13:30', 90, 'Foco 2: programação', 'trabalho', 'code', { subtitle: 'Uma tarefa por vez, sem abrir WhatsApp' }),
      act('comercial', '15:00', 60, 'Comercial', 'comercial', 'briefcase', { subtitle: 'Responder contatos, follow-up, propostas, divulgação, reuniões' }),
      act('projetos', '16:00', 60, 'Projetos paralelos', 'projetos', 'monitor', { subtitle: 'Um projeto por dia · {projeto}' }),
      act('fechar', '17:00', 60, 'Fechar o dia', 'fechamento', 'flag', { subtitle: 'Anotar onde parei e as 3 prioridades de amanhã, fechar as abas' }),
      act('casa', '18:00', 30, 'Casa (30 min)', 'corpo', 'home', { days: [1, 2, 3, 4], subtitle: 'Louça + {casa}' }),
      act('familia', '18:30', 180, 'Família e descanso', 'familia', 'users'),
      act('igreja', '19:00', 120, 'Igreja', 'compromisso', 'church', { days: [2], priority: 10, subtitle: 'Das 19h às 21h' }),
      act('futebol', '18:00', 120, 'Futebol', 'compromisso', 'ball', { days: [5], priority: 10, subtitle: 'Das 18h às 20h · sem tarefa de casa hoje' }),

      act('acordar-sab', '06:40', 80, 'Acordar e café com calma', 'basico', 'sun', { days: [6], subtitle: 'Manter o horário do sono, inclusive no fim de semana' }),
      act('roupa', '08:00', 60, 'Lavar roupa', 'corpo', 'shirt', { days: [6] }),
      act('mercado', '09:30', 90, 'Fazer mercado', 'corpo', 'cart', { days: [6], subtitle: 'Levar a lista feita no domingo' }),
      act('livre-sab', '11:00', 630, 'Resto do dia livre', 'familia', 'heart', { days: [6], subtitle: 'Lazer sem culpa', alertAdvance: false }),

      act('acordar-dom', '06:40', 80, 'Acordar e café com calma', 'basico', 'sun', { days: [0], subtitle: 'Manter o horário do sono' }),
      act('descanso-dom', '08:00', 660, 'Descanso', 'familia', 'heart', { days: [0], subtitle: 'Dia de descanso e família', alertAdvance: false }),
      act('planejar', '19:00', 20, 'Planejar a semana (20 min)', 'fechamento', 'calendar', { days: [0], subtitle: 'Reuniões, projeto de cada dia, contas, lista do mercado' }),
      act('familia-dom', '19:20', 130, 'Família e descanso', 'familia', 'users', { days: [0], alertAdvance: false }),

      act('telas', '21:30', 30, 'Desligar as telas', 'basico', 'phone', { days: ALL_DAYS }),
      act('cama', '22:00', 30, 'Cama', 'sono', 'bed', { days: ALL_DAYS, subtitle: 'No máximo 22:30' })
    ],
    // Índice = dia da semana (0 = domingo)
    weekly: [
      { casa: '', nota: 'Descanso e planejar a semana (20 min)', projeto: '' },
      { casa: 'cozinha', nota: 'Noite livre', projeto: '' },
      { casa: 'banheiro', nota: 'Igreja das 19h às 21h', projeto: '' },
      { casa: 'quarto e roupa de cama', nota: 'Noite livre', projeto: '' },
      { casa: 'sala e mesa de trabalho', nota: 'Noite livre', projeto: '' },
      { casa: '', nota: 'Sem tarefa de casa · Futebol das 18h às 20h', projeto: '' },
      { casa: 'lavar roupa e fazer mercado', nota: 'Resto do dia livre', projeto: '' }
    ],
    exceptions: [],
    lists: {
      regras: [
        'Foco é protegido.',
        'Reuniões no horário do comercial.',
        'Se não der, trocar pelo estudo ou pelos projetos, nunca pelo foco.',
        'Se perdi um bloco, sigo para o próximo, sem culpa.',
        'Se estiver rendendo, posso esticar um pouco.',
        'Meta: cumprir 70%, não 100%.'
      ],
      casaTodoDia: ['Louça'],
      sono: [
        'Acordar sempre perto das 6:40, inclusive no fim de semana.',
        'Adiantar a hora de dormir em 15 a 20 min a cada poucos dias, até chegar às 22h.',
        'Não programar à noite.',
        'Às 21:30, desligar as telas.'
      ],
      planejamento: [
        'Ver as reuniões e os compromissos da semana',
        'Escolher o projeto de cada dia',
        'Ver as contas a pagar',
        'Fazer a lista do mercado',
        'Ajustar o que não funcionou'
      ],
      lembretes: ['Beber água', 'Fazer pausas', 'Pagar as contas', 'Ter tempo com meu filho e a família', 'Ter lazer sem culpa']
    },
    meta: 'cumprir 70%, não 100%.',
    settings: {
      alerts: {
        enabled: true,
        soundStart: 'sino',
        soundAdvance: 'gota',
        customSound: '',
        volume: 0.6,
        advanceEnabled: true,
        advanceMinutes: 5,
        windowsNotification: true,
        popup: true,
        popupSeconds: 30,
        snoozeMinutes: 5
      },
      floating: {
        enabled: true,
        alwaysOnTop: true,
        opacity: 0.97
      },
      general: {
        startWithWindows: true,
        closeToTray: true
      }
    }
  };
}

function createDefaultState() {
  return {
    paused: false,
    muteUntil: 0,
    snoozes: [],
    lastAlert: null,
    trayHintShown: false,
    mainBounds: null,
    floatingBounds: null
  };
}

module.exports = { createDefaultConfig, createDefaultState };
