import React, { useState, useEffect, useRef, type CSSProperties } from 'react';
import Head from 'next/head';
import { 
  Send, 
  Bot, 
  User, 
  Settings, 
  Cpu, 
  Activity, 
  Shield, 
  History,
  Trash2,
  Download,
  Terminal,
  ChevronRight,
  Plus,
  Mic,
  Zap,
  Info,
  Globe,
  Code2,
  Sparkles,
  Check,
  Paperclip,
  Image as ImageIcon,
  FlaskConical,
  ShoppingBag,
  Search,
  Ellipsis,
  Pin,
  RotateCcw,
  Pencil,
  Upload,
  Gauge,
  TerminalSquare,
  X,
  Save
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import axios from 'axios';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ApiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface Persona {
  id: string;
  name: string;
  prompt: string;
}

interface UploadedFileItem {
  filename: string;
  path?: string;
}

interface CitationItem {
  filename: string;
  chunk: number;
  snippet: string;
}

interface SlashCommandDefinition {
  command: string;
  description: string;
}

interface QuickPaletteItem {
  id: string;
  group: 'actions' | 'modes' | 'sessions' | 'commands';
  title: string;
  subtitle: string;
  keywords: string;
  hint?: string;
  action: () => void;
}

type DensityMode = 'comfortable' | 'compact';

interface SystemStats {
  cpu: number;
  memory: number;
  ollama_connected: boolean;
}

interface ModelOption {
  name: string;
  provider: string;
}

interface StreamChunk {
  content?: string;
  done?: boolean;
  error?: string;
  status?: string;
  phase?: string;
  message?: {
    role?: Message['role'];
    content?: string;
  };
  citations?: CitationItem[];
}

interface BrowserSpeechRecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    speechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const LOW_RESOURCE_MODE = process.env.NEXT_PUBLIC_LOW_RESOURCE_MODE === 'true';
const DEFAULT_PERSONAS: Persona[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    prompt: 'You are a balanced assistant. Be accurate, clear, and practical.'
  },
  {
    id: 'developer',
    name: 'Developer',
    prompt: 'You are a senior software engineer assistant. Prefer concrete implementation guidance and concise examples.'
  },
  {
    id: 'teacher',
    name: 'Teacher',
    prompt: 'You are an instructional assistant. Explain clearly and step-by-step.'
  }
];

const DEFAULT_PINNED_PROMPTS = [
  'Summarize this chat in 5 bullets',
  'Suggest next development steps',
  'Generate tests for the last code block',
  'Find likely performance bottlenecks'
];
const syntaxTheme: Record<string, CSSProperties> = vscDarkPlus;
const markdownComponents: Components = {
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className ?? '');
    const codeString = String(children).replace(/\n$/, '');

    if (match) {
      return (
        <div className="relative group/code my-6">
          <div className="absolute top-0 left-0 right-0 h-8 bg-[#1a1a1a] rounded-t-lg border-x border-t border-[#2a2a2a] flex items-center justify-between px-4">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">{match[1]}</span>
            <button 
              onClick={() => navigator.clipboard.writeText(codeString)}
              className="text-zinc-500 hover:text-white transition-colors"
              title="Copy Code"
            >
              <Download size={12} />
            </button>
          </div>
          <SyntaxHighlighter
            style={syntaxTheme}
            language={match[1]}
            PreTag="div"
            className="rounded-b-lg border-x border-b border-[#2a2a2a] !m-0 !pt-10"
          >
            {codeString}
          </SyntaxHighlighter>
        </div>
      );
    }

    return (
      <code
        className={cn("bg-[#1a1a1a] px-1.5 py-0.5 rounded text-[#ff7a00] font-mono text-[13px]", className)}
      >
        {children}
      </code>
    );
  }
};

export default function CogniraApp() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState('free (Cloud)');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [sessionId, setSessionId] = useState('default');
  const [sessions, setSessions] = useState<{id: string, title: string}[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [devMode, setDevMode] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [webAssistMode, setWebAssistMode] = useState(false);
  const [conciseMode, setConciseMode] = useState(false);
  const [performanceMode, setPerformanceMode] = useState(LOW_RESOURCE_MODE);
  const [thinkingStatus, setThinkingStatus] = useState('Thinking...');
  const [thinkingPhase, setThinkingPhase] = useState('init');
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [hasReceivedContent, setHasReceivedContent] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>(DEFAULT_PERSONAS);
  const [selectedPersonaId, setSelectedPersonaId] = useState('balanced');
  const [reusableSystemPrompt, setReusableSystemPrompt] = useState('');
  const [pinnedPrompts, setPinnedPrompts] = useState<string[]>(DEFAULT_PINNED_PROMPTS);
  const [attachedFiles, setAttachedFiles] = useState<UploadedFileItem[]>([]);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [densityMode, setDensityMode] = useState<DensityMode>('comfortable');
  const [showTopThinkingBadge, setShowTopThinkingBadge] = useState(true);
  const [showSystemHealthCard, setShowSystemHealthCard] = useState(true);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteCursor, setPaletteCursor] = useState(0);
  const [showShortcutsPanel, setShowShortcutsPanel] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const historySearchRef = useRef<HTMLInputElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const handleQuickAction = (action: 'files' | 'image' | 'research' | 'shopping' | 'web' | 'more') => {
    const quickPrompts: Record<typeof action, string> = {
      files: 'I want to attach files and analyze them. What is the best workflow?',
      image: 'Create an image prompt for: ',
      research: 'Run deep research on: ',
      shopping: 'Help me compare options for: ',
      web: 'Search the web for: ',
      more: 'Show advanced options and shortcuts for this chat.'
    };

    if (action === 'web') {
      setWebAssistMode(true);
    }

    setInput(prev => prev || quickPrompts[action]);
    setShowModeMenu(false);
  };

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredSessions = sessions.filter((session) => {
    if (!normalizedSearchQuery) {
      return true;
    }

    return (
      session.title.toLowerCase().includes(normalizedSearchQuery) ||
      session.id.toLowerCase().includes(normalizedSearchQuery)
    );
  });

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: LOW_RESOURCE_MODE ? 'auto' : 'smooth' });
  };

  const handleChatScroll = () => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    const threshold = 120;
    const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
    setIsNearBottom(distanceToBottom < threshold);
  };

  useEffect(() => {
    if (isNearBottom) {
      scrollToBottom();
    }
  }, [messages, isNearBottom]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!modeMenuRef.current) {
        return;
      }

      if (!modeMenuRef.current.contains(event.target as Node)) {
        setShowModeMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    try {
      const storedDevMode = localStorage.getItem('cognira_mode_dev');
      const storedWebAssist = localStorage.getItem('cognira_mode_web');
      const storedConcise = localStorage.getItem('cognira_mode_concise');
      const storedPerformance = localStorage.getItem('cognira_mode_perf');
      const storedPersonas = localStorage.getItem('cognira_personas');
      const storedPersonaId = localStorage.getItem('cognira_persona_selected');
      const storedReusablePrompt = localStorage.getItem('cognira_reusable_prompt');
      const storedPinned = localStorage.getItem('cognira_pinned_prompts');
      const storedDensity = localStorage.getItem('cognira_density_mode');
      const storedTopThinkingBadge = localStorage.getItem('cognira_show_top_thinking_badge');
      const storedSystemHealthCard = localStorage.getItem('cognira_show_system_health_card');
      const storedSidebar = localStorage.getItem('cognira_show_sidebar');
      if (storedDevMode !== null) setDevMode(storedDevMode === 'true');
      if (storedWebAssist !== null) setWebAssistMode(storedWebAssist === 'true');
      if (storedConcise !== null) setConciseMode(storedConcise === 'true');
      if (storedPerformance !== null) setPerformanceMode(storedPerformance === 'true');
      if (storedPersonas) setPersonas(JSON.parse(storedPersonas) as Persona[]);
      if (storedPersonaId) setSelectedPersonaId(storedPersonaId);
      if (storedReusablePrompt) setReusableSystemPrompt(storedReusablePrompt);
      if (storedPinned) setPinnedPrompts(JSON.parse(storedPinned) as string[]);
      if (storedDensity === 'compact' || storedDensity === 'comfortable') setDensityMode(storedDensity);
      if (storedTopThinkingBadge !== null) setShowTopThinkingBadge(storedTopThinkingBadge === 'true');
      if (storedSystemHealthCard !== null) setShowSystemHealthCard(storedSystemHealthCard === 'true');
      if (storedSidebar !== null) setShowSidebar(storedSidebar === 'true');
    } catch (error) {
      console.error('Failed to load mode preferences', error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('cognira_mode_dev', String(devMode));
      localStorage.setItem('cognira_mode_web', String(webAssistMode));
      localStorage.setItem('cognira_mode_concise', String(conciseMode));
      localStorage.setItem('cognira_mode_perf', String(performanceMode));
      localStorage.setItem('cognira_personas', JSON.stringify(personas));
      localStorage.setItem('cognira_persona_selected', selectedPersonaId);
      localStorage.setItem('cognira_reusable_prompt', reusableSystemPrompt);
      localStorage.setItem('cognira_pinned_prompts', JSON.stringify(pinnedPrompts));
      localStorage.setItem('cognira_density_mode', densityMode);
      localStorage.setItem('cognira_show_top_thinking_badge', String(showTopThinkingBadge));
      localStorage.setItem('cognira_show_system_health_card', String(showSystemHealthCard));
      localStorage.setItem('cognira_show_sidebar', String(showSidebar));
    } catch (error) {
      console.error('Failed to save mode preferences', error);
    }
  }, [devMode, webAssistMode, conciseMode, performanceMode, personas, selectedPersonaId, reusableSystemPrompt, pinnedPrompts, densityMode, showTopThinkingBadge, showSystemHealthCard, showSidebar]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowCommandPalette((prev) => !prev);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === '/') {
        event.preventDefault();
        setShowShortcutsPanel((prev) => !prev);
        return;
      }

      if (event.altKey && event.key === '1') {
        event.preventDefault();
        composerInputRef.current?.focus();
        return;
      }

      if (event.altKey && event.key === '2') {
        event.preventDefault();
        setShowSidebar(true);
        setTimeout(() => historySearchRef.current?.focus(), 0);
        return;
      }

      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        handleNewChat();
        return;
      }

      if (event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setShowSidebar((prev) => !prev);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setShowSettingsPanel(true);
        return;
      }

      if (event.key === 'Escape') {
        setShowSettingsPanel(false);
        setShowCommandPalette(false);
        setShowShortcutsPanel(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!showCommandPalette) {
      setPaletteQuery('');
      setPaletteCursor(0);
      return;
    }

    setTimeout(() => {
      paletteInputRef.current?.focus();
    }, 0);
  }, [showCommandPalette]);

  useEffect(() => {
    setPaletteCursor(0);
  }, [paletteQuery]);

  useEffect(() => {
    try {
      const storedDraft = localStorage.getItem(`cognira_draft_${sessionId}`);
      if (storedDraft) {
        setInput(storedDraft);
      } else {
        setInput('');
      }
    } catch (error) {
      console.error('Failed to load session draft', error);
    }
  }, [sessionId]);

  useEffect(() => {
    try {
      localStorage.setItem(`cognira_draft_${sessionId}`, input);
    } catch (error) {
      console.error('Failed to save session draft', error);
    }
  }, [sessionId, input]);

  useEffect(() => {
    try {
      const rawPresets = localStorage.getItem('cognira_session_presets');
      const presets = rawPresets ? JSON.parse(rawPresets) as Record<string, { dev: boolean; web: boolean; concise: boolean; perf: boolean; personaId: string }> : {};
      const preset = presets[sessionId];
      if (preset) {
        setDevMode(preset.dev);
        setWebAssistMode(preset.web);
        setConciseMode(preset.concise);
        setPerformanceMode(preset.perf);
        setSelectedPersonaId(preset.personaId || 'balanced');
      }
    } catch (error) {
      console.error('Failed to load session presets', error);
    }
  }, [sessionId]);

  useEffect(() => {
    try {
      const rawPresets = localStorage.getItem('cognira_session_presets');
      const presets = rawPresets ? JSON.parse(rawPresets) as Record<string, { dev: boolean; web: boolean; concise: boolean; perf: boolean; personaId: string }> : {};
      presets[sessionId] = {
        dev: devMode,
        web: webAssistMode,
        concise: conciseMode,
        perf: performanceMode,
        personaId: selectedPersonaId
      };
      localStorage.setItem('cognira_session_presets', JSON.stringify(presets));
    } catch (error) {
      console.error('Failed to save session presets', error);
    }
  }, [sessionId, devMode, webAssistMode, conciseMode, performanceMode, selectedPersonaId]);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    const startedAt = Date.now();
    const tick = () => {
      setThinkingSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isLoading]);

  const thinkingLabel = thinkingSeconds < 2
    ? 'Thought for a moment'
    : thinkingSeconds < 8
      ? 'Thought for a couple of seconds'
      : `Thought for ${thinkingSeconds} seconds`;

  // Fetch health stats periodically
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await axios.get(`${API_URL}/health`);
        setStats(response.data);
      } catch (error) {
        console.error('Health check failed', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, performanceMode ? 30000 : 5000);
    return () => clearInterval(interval);
  }, [performanceMode]);

  // Fetch available models
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await axios.get(`${API_URL}/models`);
        if (response.data.models) {
          const availableModels = response.data.models as ModelOption[];
          setModels(availableModels);
          setModel((currentModel) => (
            availableModels.some((availableModel) => availableModel.name === currentModel)
              ? currentModel
              : (availableModels[0]?.name ?? currentModel)
          ));
        }
      } catch (error) {
        console.error('Failed to fetch models', error);
      }
    };
    fetchModels();
  }, []);

  // Load chat history
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await axios.get(`${API_URL}/history/${sessionId}`);
        if (response.data.messages) {
          setMessages(response.data.messages);
        }
      } catch (error) {
        console.error('Failed to fetch history', error);
      }
    };
    const fetchSessions = async () => {
      try {
        const response = await axios.get(`${API_URL}/sessions`);
        if (response.data.sessions) {
          setSessions(response.data.sessions);
        }
      } catch (error) {
        console.error('Failed to fetch sessions', error);
      }
    };
    fetchHistory();
    fetchSessions();
  }, [sessionId]);

  const appendAssistantNotice = (content: string) => {
    setMessages((prev) => [...prev, { role: 'assistant', content }]);
  };

  const executeSlashCommand = async (rawInput: string): Promise<boolean> => {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('/')) {
      return false;
    }

    const [rawCommand, ...parts] = trimmed.split(/\s+/);
    const command = rawCommand.toLowerCase();
    const arg = parts.join(' ').trim();

    const setBooleanWithNotice = (
      label: string,
      setter: React.Dispatch<React.SetStateAction<boolean>>
    ) => {
      let nextValue = false;
      setter((current) => {
        nextValue = !current;
        return nextValue;
      });
      appendAssistantNotice(`${label} ${nextValue ? 'enabled' : 'disabled'}.`);
    };

    if (command === '/help') {
      appendAssistantNotice(
        [
          'Available slash commands:',
          '- `/new` start a new chat session',
          '- `/clear` clear history for the current session',
          '- `/dev` toggle developer mode',
          '- `/web` toggle web assist fallback',
          '- `/concise` toggle concise replies',
          '- `/perf` toggle performance mode',
          '- `/persona <balanced|developer|teacher>` switch persona',
          '- `/prompt <text>` set reusable system prompt',
          '- `/files` open file picker'
        ].join('\n')
      );
      return true;
    }

    if (command === '/new') {
      handleNewChat();
      appendAssistantNotice('Started a new chat session.');
      return true;
    }

    if (command === '/clear') {
      await handleClearHistory();
      appendAssistantNotice('Cleared history for this session.');
      return true;
    }

    if (command === '/dev') {
      setBooleanWithNotice('Developer mode', setDevMode);
      return true;
    }

    if (command === '/web') {
      setBooleanWithNotice('Web assist mode', setWebAssistMode);
      return true;
    }

    if (command === '/concise') {
      setBooleanWithNotice('Concise mode', setConciseMode);
      return true;
    }

    if (command === '/perf') {
      setBooleanWithNotice('Performance mode', setPerformanceMode);
      return true;
    }

    if (command === '/persona') {
      const normalizedArg = arg.toLowerCase();
      const matchedPersona = personas.find(
        (persona) => persona.id.toLowerCase() === normalizedArg || persona.name.toLowerCase() === normalizedArg
      );

      if (!matchedPersona) {
        appendAssistantNotice('Persona not found. Use `/persona balanced`, `/persona developer`, or `/persona teacher`.');
        return true;
      }

      setSelectedPersonaId(matchedPersona.id);
      appendAssistantNotice(`Persona set to ${matchedPersona.name}.`);
      return true;
    }

    if (command === '/prompt') {
      if (!arg) {
        appendAssistantNotice('Usage: `/prompt <text>`');
        return true;
      }

      setReusableSystemPrompt(arg);
      appendAssistantNotice('Reusable system prompt updated.');
      return true;
    }

    if (command === '/files') {
      fileInputRef.current?.click();
      appendAssistantNotice('File picker opened.');
      return true;
    }

    appendAssistantNotice('Unknown command. Use `/help` to see available commands.');
    return true;
  };

  const handleSendMessage = async (overrideInput?: string, baseMessages?: Message[]) => {
    if (isLoading) return;

    const trimmedInput = (overrideInput ?? input).trim();
    if (!trimmedInput) return;

    if (await executeSlashCommand(trimmedInput)) {
      setInput('');
      return;
    }

    const userMessage: Message = { role: 'user', content: trimmedInput };
    const assistantMessage: Message = { role: 'assistant', content: '' };
    const sourceMessages = baseMessages ?? messages;
    const nextMessages = [...sourceMessages, userMessage];
    const modeInstructions: string[] = [];
    const selectedPersona = personas.find((p) => p.id === selectedPersonaId);

    if (devMode) {
      modeInstructions.push('Developer mode is enabled. Prefer technical, implementation-focused, and explicit reasoning when useful.');
    }
    if (conciseMode) {
      modeInstructions.push('Keep responses concise and practical unless the user explicitly asks for detailed output.');
    }
    if (webAssistMode) {
      modeInstructions.push('If cloud LLM is unavailable, provide the best possible web-assisted answer with clear source links.');
    }
    if (selectedPersona?.prompt) {
      modeInstructions.push(selectedPersona.prompt);
    }
    if (reusableSystemPrompt.trim()) {
      modeInstructions.push(reusableSystemPrompt.trim());
    }

    let requestCitations: CitationItem[] = [];
    if (attachedFiles.length > 0) {
      try {
        const fileSearch = await axios.get(`${API_URL}/files/search`, { params: { q: trimmedInput } });
        requestCitations = (fileSearch.data?.citations || []) as CitationItem[];
        if (requestCitations.length > 0) {
          const citationContext = requestCitations
            .slice(0, 4)
            .map((c, idx) => `${idx + 1}) ${c.filename} [chunk ${c.chunk}] ${c.snippet}`)
            .join('\n');
          modeInstructions.push(`Use attached file context when relevant:\n${citationContext}`);
        }
      } catch (error) {
        console.error('Failed to query file citations', error);
      }
    }

    const apiMessages: ApiMessage[] = modeInstructions.length > 0
      ? [{ role: 'system', content: modeInstructions.join(' ') }, ...nextMessages]
      : nextMessages;

    setMessages([...sourceMessages, userMessage, assistantMessage]);
    setInput('');
    setIsLoading(true);
    setHasReceivedContent(false);
    setThinkingStatus('Thinking...');
    setThinkingPhase('init');
    setThinkingSeconds(0);
    setCitations(requestCitations);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: true,
          session_id: sessionId
        })
      });

      if (!response.ok) {
        throw new Error(`Backend request failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error('No response body from Cognira backend.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      let isStreamComplete = false;

      const updateAssistantMessage = (content: string) => {
        setMessages(prev => {
          if (prev.length === 0) {
            return prev;
          }

          const newMessages = [...prev];
          const lastIndex = newMessages.length - 1;

          if (newMessages[lastIndex]?.role !== 'assistant') {
            return newMessages;
          }

          newMessages[lastIndex] = {
            ...newMessages[lastIndex],
            content
          };
          return newMessages;
        });
      };

      const processEvent = (eventText: string) => {
        const line = eventText.trim();
        if (!line.startsWith('data:')) {
          return;
        }

        const jsonStr = line.slice(5).trim();
        if (!jsonStr) {
          return;
        }

        const data = JSON.parse(jsonStr) as StreamChunk;

        if (data.error) {
          throw new Error(data.error);
        }

        if (data.status) {
          setThinkingStatus(data.status);
        }
        if (data.phase) {
          setThinkingPhase(data.phase);
        }

        if (data.citations && data.citations.length > 0) {
          setCitations(data.citations);
        }

        const content = data.message?.content ?? data.content ?? '';
        if (content) {
          setHasReceivedContent(true);
          fullContent += content;
          updateAssistantMessage(fullContent);
        }

        if (data.done) {
          isStreamComplete = true;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const eventText of events) {
          processEvent(eventText);
          if (isStreamComplete) {
            break;
          }
        }

        if (done || isStreamComplete) {
          break;
        }
      }

      if (buffer.trim()) {
        processEvent(buffer);
      }
    } catch (error) {
      console.error('Streaming error', error);
      const errorMessage = error instanceof Error
        ? error.message
        : 'Failed to connect to the Cognira backend. Make sure the local server is running.';

      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          ...newMessages[newMessages.length - 1],
          content: `Error: ${errorMessage}`
        };
        return newMessages;
      });
    } finally {
      setIsLoading(false);
      setThinkingStatus('Thinking...');
      setThinkingPhase('init');
      setThinkingSeconds(0);
      setEditingMessageIndex(null);
      setEditingText('');
      // Refresh session titles
      try {
        const response = await axios.get(`${API_URL}/sessions`);
        setSessions(response.data.sessions || []);
      } catch (e) {
        console.error("Failed to refresh sessions", e);
      }
    }
  };

  const handleRegenerateResponse = async () => {
    if (isLoading) {
      return;
    }

    const lastUserIndex = [...messages].map((m, i) => ({ ...m, i })).reverse().find((m) => m.role === 'user')?.i;
    if (lastUserIndex === undefined) {
      return;
    }

    const base = messages.slice(0, lastUserIndex);
    const lastUserPrompt = messages[lastUserIndex]?.content || '';
    await handleSendMessage(lastUserPrompt, base);
  };

  const startEditingMessage = (index: number, content: string) => {
    setEditingMessageIndex(index);
    setEditingText(content);
  };

  const applyEditedMessage = async () => {
    if (editingMessageIndex === null) {
      return;
    }
    const base = messages.slice(0, editingMessageIndex);
    await handleSendMessage(editingText, base);
  };

  const pinCurrentPrompt = () => {
    const cleaned = input.trim();
    if (!cleaned) {
      return;
    }
    if (pinnedPrompts.includes(cleaned)) {
      return;
    }
    setPinnedPrompts((prev) => [cleaned, ...prev].slice(0, 10));
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const uploaded: UploadedFileItem[] = [];
    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        const response = await axios.post(`${API_URL}/files/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        uploaded.push(response.data as UploadedFileItem);
      } catch (error) {
        console.error('Failed to upload file', error);
      }
    }

    if (uploaded.length > 0) {
      setAttachedFiles((prev) => [...uploaded, ...prev]);
    }
  };

  const runSuggestedCommand = async (command: string) => {
    try {
      const response = await axios.post(`${API_URL}/tools/system`, null, {
        params: { command }
      });
      const stdout = response.data?.stdout || '';
      const stderr = response.data?.stderr || '';
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      appendAssistantNotice(
        output
          ? ['Command output:', '```', output, '```'].join('\n')
          : 'Command completed with no output.'
      );
    } catch (error) {
      console.error('Failed to run suggested command', error);
      appendAssistantNotice('Command failed to execute.');
    }
  };

  const resetUiSettings = () => {
    setDensityMode('comfortable');
    setShowTopThinkingBadge(true);
    setShowSystemHealthCard(true);
    setPerformanceMode(LOW_RESOURCE_MODE);
    setShowSidebar(true);
  };

  const exportUiSettings = async () => {
    const payload = {
      densityMode,
      showTopThinkingBadge,
      showSystemHealthCard,
      performanceMode,
      showSidebar,
      selectedPersonaId,
      reusableSystemPrompt
    };
    await copyToClipboard(JSON.stringify(payload, null, 2));
  };

  const handleNewChat = () => {
    const newId = `session_${Date.now()}`;
    setSessionId(newId);
    setMessages([]);
  };

  const handleClearHistory = async () => {
    try {
      await axios.delete(`${API_URL}/history/${sessionId}`);
      setMessages([]);
      // Refresh sessions
      const response = await axios.get(`${API_URL}/sessions`);
      setSessions(response.data.sessions || []);
    } catch (error) {
      console.error('Failed to clear history', error);
    }
  };

  const toggleVoiceInput = () => {
    const SpeechRecognition =
      window.SpeechRecognition ??
      window.webkitSpeechRecognition ??
      window.speechRecognition;

    if (!SpeechRecognition) {
      alert("Voice input is not supported in this browser.");
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + (prev ? ' ' : '') + transcript);
      setIsRecording(false);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsRecording(false);
    };

    recognition.start();
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy!', err);
    }
  };

  const extractRunnableCommands = (content: string): string[] => {
    const commands: string[] = [];
    const blockRegex = /```(?:bash|sh|powershell|pwsh|cmd)?\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(content)) !== null) {
      const candidate = match[1].trim();
      if (candidate && candidate.length < 400) {
        commands.push(candidate);
      }
    }
    return commands.slice(0, 2);
  };

  const renderedMessages = performanceMode && messages.length > 80
    ? messages.slice(-80)
    : messages;
  const renderedOffset = messages.length - renderedMessages.length;
  const slashCommandDefinitions: SlashCommandDefinition[] = [
    { command: '/help', description: 'Show all slash commands' },
    { command: '/new', description: 'Start a fresh chat session' },
    { command: '/clear', description: 'Clear current session history' },
    { command: '/dev', description: 'Toggle developer mode' },
    { command: '/web', description: 'Toggle web assist mode' },
    { command: '/concise', description: 'Toggle concise responses' },
    { command: '/perf', description: 'Toggle performance mode' },
    { command: '/persona', description: 'Set persona (balanced/developer/teacher)' },
    { command: '/prompt', description: 'Set reusable system prompt' },
    { command: '/files', description: 'Open file picker' }
  ];
  const isSlashMode = input.trimStart().startsWith('/');
  const slashFilter = input.trim().toLowerCase();
  const visibleSlashCommands = isSlashMode
    ? slashCommandDefinitions.filter((item) => item.command.startsWith(slashFilter || '/'))
    : [];
  const currentSessionTitle = sessions.find((session) => session.id === sessionId)?.title || 'Active Session';
  const activeModes = [
    devMode ? 'Developer' : null,
    webAssistMode ? 'Web' : null,
    conciseMode ? 'Concise' : null,
    performanceMode ? 'Performance' : null
  ].filter(Boolean) as string[];

  const closePalette = () => {
    setShowCommandPalette(false);
  };

  const quickPaletteItems: QuickPaletteItem[] = [
    {
      id: 'new-chat',
      group: 'actions',
      title: 'Start New Chat',
      subtitle: 'Create a fresh session',
      keywords: 'new chat session clear',
      hint: 'Alt+N',
      action: () => {
        handleNewChat();
        closePalette();
      }
    },
    {
      id: 'toggle-sidebar',
      group: 'actions',
      title: showSidebar ? 'Hide Sidebar' : 'Show Sidebar',
      subtitle: 'Toggle chat navigation panel',
      keywords: 'sidebar nav panel toggle',
      hint: 'Alt+B',
      action: () => {
        setShowSidebar((prev) => !prev);
        closePalette();
      }
    },
    {
      id: 'open-settings',
      group: 'actions',
      title: 'Open Settings',
      subtitle: 'Configure UI and behavior',
      keywords: 'settings preferences config',
      hint: 'Ctrl+,',
      action: () => {
        setShowSettingsPanel(true);
        closePalette();
      }
    },
    {
      id: 'focus-composer',
      group: 'actions',
      title: 'Focus Composer',
      subtitle: 'Jump to message input',
      keywords: 'input compose prompt',
      hint: 'Alt+1',
      action: () => {
        composerInputRef.current?.focus();
        closePalette();
      }
    },
    {
      id: 'focus-history',
      group: 'actions',
      title: 'Search Sessions',
      subtitle: 'Focus history search',
      keywords: 'history sessions search',
      hint: 'Alt+2',
      action: () => {
        setShowSidebar(true);
        setTimeout(() => historySearchRef.current?.focus(), 0);
        closePalette();
      }
    },
    {
      id: 'show-shortcuts',
      group: 'actions',
      title: 'Open Keyboard Shortcuts',
      subtitle: 'View productivity shortcuts',
      keywords: 'help shortcuts keyboard',
      hint: 'Ctrl+/',
      action: () => {
        setShowShortcutsPanel(true);
        closePalette();
      }
    },
    {
      id: 'copy-session-id',
      group: 'actions',
      title: 'Copy Session ID',
      subtitle: `Copy ${sessionId}`,
      keywords: 'session id copy',
      action: () => {
        void copyToClipboard(sessionId);
        closePalette();
      }
    },
    {
      id: 'mode-dev',
      group: 'modes',
      title: `${devMode ? 'Disable' : 'Enable'} Developer Mode`,
      subtitle: 'Technical implementation-focused responses',
      keywords: 'mode developer debug code',
      action: () => {
        setDevMode((prev) => !prev);
        closePalette();
      }
    },
    {
      id: 'mode-web',
      group: 'modes',
      title: `${webAssistMode ? 'Disable' : 'Enable'} Web Assist`,
      subtitle: 'Web fallback when cloud model is unavailable',
      keywords: 'mode web fallback search',
      action: () => {
        setWebAssistMode((prev) => !prev);
        closePalette();
      }
    },
    {
      id: 'mode-concise',
      group: 'modes',
      title: `${conciseMode ? 'Disable' : 'Enable'} Concise Mode`,
      subtitle: 'Shorter practical responses',
      keywords: 'mode concise short',
      action: () => {
        setConciseMode((prev) => !prev);
        closePalette();
      }
    },
    {
      id: 'mode-performance',
      group: 'modes',
      title: `${performanceMode ? 'Disable' : 'Enable'} Performance Mode`,
      subtitle: 'Lower rendering and polling overhead',
      keywords: 'mode performance speed',
      action: () => {
        setPerformanceMode((prev) => !prev);
        closePalette();
      }
    },
    ...slashCommandDefinitions.map((item) => ({
      id: `slash-${item.command}`,
      group: 'commands' as const,
      title: `Insert ${item.command}`,
      subtitle: item.description,
      keywords: `${item.command} slash command`,
      hint: 'Slash',
      action: () => {
        setInput(`${item.command} `);
        setTimeout(() => composerInputRef.current?.focus(), 0);
        closePalette();
      }
    })),
    ...filteredSessions.slice(0, 8).map((session, idx) => ({
      id: `session-${session.id || idx}`,
      group: 'sessions' as const,
      title: session.title || 'Untitled Session',
      subtitle: `Open ${session.id}`,
      keywords: `${session.title} ${session.id} recent history`,
      hint: 'Enter',
      action: () => {
        setSessionId(session.id);
        closePalette();
      }
    }))
  ];

  const normalizedPaletteQuery = paletteQuery.trim().toLowerCase();
  const getPaletteScore = (item: QuickPaletteItem, query: string) => {
    if (!query) {
      return 1;
    }

    const title = item.title.toLowerCase();
    const subtitle = item.subtitle.toLowerCase();
    const keywords = item.keywords.toLowerCase();

    if (title === query) return 100;
    if (title.startsWith(query)) return 75;
    if (keywords.includes(query)) return 55;
    if (subtitle.includes(query)) return 40;

    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length > 1 && terms.every((term) => `${title} ${subtitle} ${keywords}`.includes(term))) {
      return 28;
    }

    return 0;
  };

  const visiblePaletteItems = quickPaletteItems
    .map((item) => ({ item, score: getPaletteScore(item, normalizedPaletteQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);

  const safePaletteCursor = visiblePaletteItems.length === 0
    ? 0
    : Math.min(paletteCursor, visiblePaletteItems.length - 1);
  const paletteGroupOrder: Array<{ key: QuickPaletteItem['group']; label: string }> = [
    { key: 'actions', label: 'Actions' },
    { key: 'modes', label: 'Modes' },
    { key: 'commands', label: 'Commands' },
    { key: 'sessions', label: 'Sessions' }
  ];
  const groupedPaletteItems = paletteGroupOrder
    .map(({ key, label }) => ({
      key,
      label,
      items: visiblePaletteItems.filter((item) => item.group === key)
    }))
    .filter((group) => group.items.length > 0);
  const inputCharCount = input.length;
  const hasDraft = input.trim().length > 0;

  return (
    <div className="flex h-screen bg-[#000000] text-zinc-100 font-sans overflow-hidden">
      <Head>
        <title>Cognira | Local AI Intelligence</title>
      </Head>

      {/* Developer Mode Banner */}
      <AnimatePresence>
        {devMode && (
          <motion.div 
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 28, opacity: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.22 }}
            className="fixed top-0 left-0 right-0 bg-[#ff7a00] text-black text-[10px] font-bold uppercase tracking-[0.2em] flex items-center justify-center z-[100] overflow-hidden"
          >
            Developer Mode Enabled
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence>
        {showSidebar && (
          <motion.div 
            initial={shouldReduceMotion ? false : { width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { width: 0, opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.24 }}
            className={cn(
              "flex flex-col border-r border-[#2a2a2a] bg-[#111111] z-20 transition-all duration-300",
              devMode && "pt-[28px]"
            )}
          >
            <div className="p-5 flex items-center justify-between border-b border-[#2a2a2a]">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2 rounded-lg transition-colors",
                  devMode ? "bg-[#ff7a00] text-black" : "bg-[#1a1a1a] text-white border border-[#2a2a2a]"
                )}>
                  <Bot size={18} />
                </div>
                <h1 className="text-sm font-bold tracking-tight">Cognira</h1>
              </div>
            </div>

            <div className="p-3 border-b border-[#2a2a2a] bg-[#101010]">
              <button
                onClick={handleNewChat}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-[#2a2a2a] bg-[#151515] text-zinc-200 hover:bg-[#1a1a1a] hover:border-zinc-600 transition-colors text-sm font-medium"
                title="New chat"
              >
                <Plus size={14} />
                New chat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
              {/* Models Section */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2 px-2">
                  <Zap size={10} className={devMode ? "text-[#ff7a00]" : ""} /> Intelligence Engine
                </label>
                <select 
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#ff7a00]/50 transition-all cursor-pointer appearance-none text-zinc-300"
                >
                  {models.map(m => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </div>

              {/* History */}
              <div className="space-y-3">
                <div className="flex items-center justify-between px-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <History size={10} /> Recent Sessions
                  </label>
                  <button 
                    onClick={handleClearHistory}
                    className="p-1 hover:text-red-500 text-zinc-700 transition-colors"
                    title="Clear Current Session"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
                
                {/* Session Search */}
                <div className="relative px-2">
                  <input 
                    ref={historySearchRef}
                    type="text"
                    placeholder="Search history..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search sessions"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg py-1.5 px-3 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#ff7a00]/30 transition-all text-zinc-400 placeholder-zinc-700"
                  />
                </div>

                <div className="space-y-1 px-1">
                  {filteredSessions.length > 0 ? (
                    filteredSessions.map((s, idx) => (
                      <div 
                        key={s.id || idx}
                        onClick={() => setSessionId(s.id)}
                        className={cn(
                          "px-3 py-2.5 rounded-lg text-[11px] truncate cursor-pointer transition-all flex flex-col gap-0.5",
                          sessionId === s.id 
                            ? "bg-[#1a1a1a] border border-[#2a2a2a] text-[#ff7a00]" 
                            : "text-zinc-500 hover:bg-[#1a1a1a]/50 hover:text-zinc-300"
                        )}
                      >
                        <span className="font-medium truncate">{s.title || 'Untitled Session'}</span>
                        <span className="text-[9px] opacity-40 font-mono">{(s.id || '').startsWith('session_') ? `ID: ${s.id.slice(-8)}` : (s.id || 'Unknown')}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-[10px] text-zinc-700 italic px-4">No records found</div>
                  )}
                </div>
              </div>

              {/* System Stats */}
              {showSystemHealthCard && (
              <div className="space-y-3 px-2 pt-4 border-t border-[#2a2a2a]/50">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Activity size={10} /> System Health
                </label>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                      <Cpu size={12} /> CPU
                    </div>
                    <span className="text-[10px] font-mono text-zinc-400">{stats?.cpu || 0}%</span>
                  </div>
                  <div className="w-full bg-black/50 h-1 rounded-full overflow-hidden">
                    <div 
                      className={cn("h-full transition-all duration-500", devMode ? "bg-[#ff7a00]" : "bg-zinc-700")} 
                      style={{ width: `${stats?.cpu || 0}%` }}
                    />
                  </div>
                </div>
              </div>
              )}
            </div>

            <div className="p-4 border-t border-[#2a2a2a] flex flex-col gap-3 bg-[#0d0d0d]">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Developer Mode</span>
                <button 
                  onClick={() => setDevMode(!devMode)}
                  className={cn(
                    "w-8 h-4 rounded-full transition-all relative",
                    devMode ? "bg-[#ff7a00]" : "bg-zinc-800"
                  )}
                >
                  <div className={cn(
                    "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow-sm",
                    devMode ? "left-4.5" : "left-0.5"
                  )} />
                </button>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-600 font-medium">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  stats?.ollama_connected ? "bg-emerald-500" : "bg-indigo-500"
                )} />
                {stats?.ollama_connected ? "LOCAL_READY" : "CLOUD_ACTIVE"}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className={cn(
        "flex-1 flex flex-col relative bg-[#000000] transition-all duration-300",
        devMode && "pt-[28px]",
        densityMode === 'compact' && 'text-[95%]'
      )}>
        {/* Top Header */}
        <header className="h-14 border-b border-[#2a2a2a] flex items-center justify-between px-6 bg-black/80 backdrop-blur-xl sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowSidebar(!showSidebar)}
              aria-label={showSidebar ? 'Collapse sidebar' : 'Expand sidebar'}
              className="p-2 -ml-2 hover:bg-[#1a1a1a] rounded-md transition-colors text-zinc-500 hover:text-white"
            >
              <ChevronRight className={cn("transition-transform duration-300", showSidebar && "rotate-180")} size={18} />
            </button>
            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
              <Info size={12} />
              <span>Cognira V1.0</span>
            </div>
            <div className="hidden lg:flex items-center gap-1 text-[10px] uppercase tracking-widest text-zinc-600">
              <span>Chat</span>
              <span className="text-zinc-800">/</span>
              <span className="max-w-[160px] truncate text-zinc-400">{currentSessionTitle}</span>
              <span className="text-zinc-800">/</span>
              <span className="text-zinc-500">{model}</span>
            </div>
            <div className="hidden md:flex items-center gap-1 rounded-lg border border-[#232323] bg-[#0f0f10] p-1">
              <button
                onClick={() => composerInputRef.current?.focus()}
                className="px-2 py-1 rounded-md text-[10px] uppercase tracking-widest text-zinc-300 hover:bg-[#1b1b1b]"
              >
                Chat
              </button>
              <button
                onClick={() => {
                  setShowSidebar(true);
                  setTimeout(() => historySearchRef.current?.focus(), 0);
                }}
                className="px-2 py-1 rounded-md text-[10px] uppercase tracking-widest text-zinc-400 hover:bg-[#1b1b1b]"
              >
                History
              </button>
              <button
                onClick={() => setShowSettingsPanel(true)}
                className="px-2 py-1 rounded-md text-[10px] uppercase tracking-widest text-zinc-400 hover:bg-[#1b1b1b]"
              >
                Settings
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-[#252525] bg-[#0f0f10] text-[10px] uppercase tracking-widest text-zinc-500">
              <span>{personas.find((p) => p.id === selectedPersonaId)?.name || 'Balanced'}</span>
              {activeModes.length > 0 && <span className="text-zinc-700">• {activeModes.join(' • ')}</span>}
            </div>
            {isLoading && showTopThinkingBadge && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-[#ff7a00] animate-pulse">
                <Activity size={12} />
                <span>THINKING...</span>
              </div>
            )}
            <button
              onClick={() => setShowCommandPalette(true)}
              className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[#2a2a2a] text-[10px] uppercase tracking-widest text-zinc-400 hover:text-zinc-100 hover:bg-[#151515]"
              aria-label="Open quick actions"
            >
              <span>Quick</span>
              <span className="text-zinc-600">Ctrl+K</span>
            </button>
            <button
              onClick={() => setShowSettingsPanel(true)}
              aria-label="Open settings"
              className="p-2 hover:bg-[#1a1a1a] rounded-md transition-colors text-zinc-500 hover:text-white"
            >
              <Settings size={18} />
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto scrollbar-hide">
          <div className={cn(
            "max-w-3xl mx-auto px-6",
            densityMode === 'compact' ? 'py-8 space-y-8' : 'py-12 space-y-12'
          )}>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-8">
                <motion.div 
                  initial={shouldReduceMotion ? false : { scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.3 }}
                  className={cn(
                    "w-16 h-16 rounded-2xl flex items-center justify-center border transition-all duration-500",
                    devMode ? "bg-[#ff7a00]/5 border-[#ff7a00]/20 text-[#ff7a00]" : "bg-white/5 border-white/10 text-white"
                  )}
                >
                  <Bot size={32} />
                </motion.div>
                <div className="space-y-3">
                  <h2 className="text-2xl font-bold tracking-tight text-white">Ask Cognira.</h2>
                  <p className="text-zinc-500 text-sm max-w-sm mx-auto leading-relaxed font-medium">Minimalistic AI intelligence platform optimized for speed and privacy.</p>
                </div>
                <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
                  {[
                    { label: 'Write a script', icon: <Terminal size={14} /> },
                    { label: 'Analyze data', icon: <Activity size={14} /> },
                    { label: 'Creative writing', icon: <Zap size={14} /> },
                    { label: 'Explain logic', icon: <Shield size={14} /> }
                  ].map(prompt => (
                    <button 
                      key={prompt.label}
                      onClick={() => setInput(prompt.label)}
                      className="p-4 bg-[#111111] border border-[#2a2a2a] rounded-xl text-left text-xs hover:border-zinc-700 hover:bg-[#1a1a1a] transition-all group flex items-center justify-between"
                    >
                      <span className="text-zinc-400 group-hover:text-white font-medium">{prompt.label}</span>
                      <span className="text-zinc-700 group-hover:text-zinc-500">{prompt.icon}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              renderedMessages.map((msg, i) => {
                const globalIndex = renderedOffset + i;
                return (
                <motion.div 
                  initial={performanceMode || shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={performanceMode ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
                  transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.22, delay: Math.min(i * 0.015, 0.18) }}
                  key={globalIndex} 
                  className={cn(
                    "flex gap-6 group",
                    msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-1 transition-colors",
                    msg.role === 'assistant' 
                      ? (devMode ? "bg-[#ff7a00]/10 text-[#ff7a00]" : "bg-white/5 text-zinc-400 border border-white/10")
                      : "bg-[#111111] text-zinc-500 border border-[#2a2a2a]"
                  )}>
                    {msg.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}
                  </div>
                  <div className={cn(
                    "flex-1 space-y-2 overflow-hidden",
                    msg.role === 'user' ? "text-right" : "text-left"
                  )}>
                    <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                      {msg.role === 'assistant' ? 'Cognira Intelligence' : 'You'}
                    </div>
                    <div className={cn(
                      "text-zinc-300 leading-relaxed prose prose-invert max-w-none text-sm font-medium",
                      msg.role === 'assistant' ? "bg-[#111111] p-4 rounded-2xl border border-[#2a2a2a] min-h-[50px]" : ""
                    )}>
                      {msg.content ? (
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          components={performanceMode ? undefined : markdownComponents}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      ) : (isLoading && globalIndex === messages.length - 1 ? (
                        <div className="space-y-2">
                          <div className="text-xs text-zinc-500 font-medium">{thinkingLabel}</div>
                          <div className="text-sm text-zinc-300">{thinkingStatus}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { key: 'init', label: 'Init' },
                              { key: 'cloud', label: 'Cloud' },
                              { key: 'cloud-attempt', label: 'Attempt' },
                              { key: 'local-fallback', label: 'Fallback' },
                              { key: 'local-chat', label: 'Local' },
                              { key: 'web-fallback', label: 'Web' }
                            ].map((phase) => (
                              <span
                                key={phase.key}
                                className={cn(
                                  'px-2 py-0.5 rounded-full text-[10px] border',
                                  thinkingPhase === phase.key
                                    ? 'text-[#ffb066] border-[#ff7a00]/40 bg-[#ff7a00]/10'
                                    : 'text-zinc-500 border-[#2a2a2a] bg-[#0f0f0f]'
                                )}
                              >
                                {phase.label}
                              </span>
                            ))}
                          </div>
                          <div className="flex gap-1.5 items-center h-4">
                            <div className="w-1.5 h-1.5 bg-[#ff7a00] rounded-full animate-bounce [animation-delay:-0.3s]" />
                            <div className="w-1.5 h-1.5 bg-[#ff7a00] rounded-full animate-bounce [animation-delay:-0.15s]" />
                            <div className="w-1.5 h-1.5 bg-[#ff7a00] rounded-full animate-bounce" />
                          </div>
                          {!hasReceivedContent && (
                            <div className="text-[11px] text-zinc-500">Cognira is planning the best response path.</div>
                          )}
                        </div>
                      ) : null)}

                      {msg.content.includes('```diff') && (
                        <div className="mt-3 p-3 rounded-xl bg-[#0f0f0f] border border-[#2a2a2a]">
                          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Diff Preview</div>
                          <pre className="text-xs text-zinc-300 whitespace-pre-wrap">{msg.content}</pre>
                        </div>
                      )}
                    </div>
                    {msg.content && (
                      <div className="flex items-center gap-3 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => copyToClipboard(msg.content)} className="text-[10px] font-bold text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 transition-colors">
                          <Download size={12} /> Copy
                        </button>
                        {msg.role === 'user' && (
                          <button
                            onClick={() => startEditingMessage(globalIndex, msg.content)}
                            className="text-[10px] font-bold text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
                          >
                            <Pencil size={12} /> Edit & Retry
                          </button>
                        )}
                        {msg.role === 'assistant' && globalIndex === messages.length - 1 && (
                          <button
                            onClick={handleRegenerateResponse}
                            className="text-[10px] font-bold text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
                          >
                            <RotateCcw size={12} /> Regenerate
                          </button>
                        )}
                        {msg.role === 'assistant' && extractRunnableCommands(msg.content).map((command) => (
                          <button
                            key={command}
                            onClick={() => runSuggestedCommand(command)}
                            className="text-[10px] font-bold text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
                          >
                            <TerminalSquare size={12} /> Run Snippet
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {!isNearBottom && messages.length > 3 && (
          <div className="absolute right-6 bottom-44 z-30">
            <button
              onClick={() => {
                scrollToBottom();
                setIsNearBottom(true);
              }}
              className="px-3 py-2 rounded-full border border-[#2a2a2a] bg-[#111111]/95 text-[11px] text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
            >
              Jump to latest
            </button>
          </div>
        )}

        {editingMessageIndex !== null && (
          <div className="px-4 sm:px-8 pb-2">
            <div className="max-w-3xl mx-auto bg-[#101010] border border-[#2a2a2a] rounded-xl p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500">Editing message and retrying from this point</div>
              <textarea
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                className="w-full min-h-[80px] bg-black/40 border border-[#2a2a2a] rounded-lg p-3 text-sm text-zinc-200"
              />
              <div className="flex items-center gap-2">
                <button onClick={applyEditedMessage} className="px-3 py-1.5 rounded-lg bg-[#ff7a00] text-black text-xs font-semibold">Apply & Retry</button>
                <button onClick={() => { setEditingMessageIndex(null); setEditingText(''); }} className="px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-zinc-300 text-xs border border-[#2a2a2a]">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Input Bar */}
        <div className="p-4 sm:p-8 bg-gradient-to-t from-black via-black to-transparent">
          <div
            className="max-w-3xl mx-auto relative"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingFiles(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDraggingFiles(false);
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setIsDraggingFiles(false);
              await handleFileUpload(e.dataTransfer.files);
            }}
          >
            {isDraggingFiles && (
              <div className="absolute inset-0 z-30 rounded-2xl border border-dashed border-[#ff7a00]/60 bg-[#ff7a00]/10 flex items-center justify-center text-sm text-[#ffb066] font-semibold">
                Drop files to attach for context
              </div>
            )}
            <div className={cn(
              "relative group bg-[#111111] border rounded-2xl transition-all duration-300",
              devMode ? "border-[#ff7a00]/30 focus-within:border-[#ff7a00] focus-within:ring-4 focus-within:ring-[#ff7a00]/5" : "border-[#2a2a2a] focus-within:border-zinc-700 focus-within:ring-4 focus-within:ring-white/5"
            )}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={async (e) => {
                  await handleFileUpload(e.target.files);
                  e.target.value = '';
                }}
              />
              <div ref={modeMenuRef} className="absolute left-3 bottom-3 z-20">
                <button
                  onClick={() => setShowModeMenu(prev => !prev)}
                  aria-label="Open mode menu"
                  className={cn(
                    "p-2.5 rounded-xl transition-all border",
                    devMode
                      ? "text-[#ff7a00] border-[#ff7a00]/30 bg-[#ff7a00]/5"
                      : "text-zinc-600 border-[#2a2a2a] hover:text-white hover:bg-white/5"
                  )}
                  title="Modes"
                >
                  <Plus size={18} />
                </button>

                <AnimatePresence>
                  {showModeMenu && (
                    <motion.div
                      initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18 }}
                      className="absolute bottom-12 left-0 w-[260px] bg-[#121212] border border-[#2b2b2b] rounded-2xl shadow-2xl overflow-hidden"
                    >
                      <div className="px-2 py-2">
                        <button
                          onClick={() => handleQuickAction('files')}
                          className="w-full px-3 py-2.5 rounded-lg text-left hover:bg-[#1b1b1b] transition-colors flex items-center gap-2.5 text-[13px] text-zinc-200"
                        >
                          <Paperclip size={14} className="text-zinc-400" />
                          <span>Add photos & files</span>
                        </button>
                        <button
                          onClick={() => handleQuickAction('image')}
                          className="w-full px-3 py-2.5 rounded-lg text-left hover:bg-[#1b1b1b] transition-colors flex items-center gap-2.5 text-[13px] text-zinc-200"
                        >
                          <ImageIcon size={14} className="text-zinc-400" />
                          <span>Create image</span>
                        </button>
                        <button
                          onClick={() => handleQuickAction('research')}
                          className="w-full px-3 py-2.5 rounded-lg text-left hover:bg-[#1b1b1b] transition-colors flex items-center gap-2.5 text-[13px] text-zinc-200"
                        >
                          <FlaskConical size={14} className="text-zinc-400" />
                          <span>Deep research</span>
                        </button>
                        <button
                          onClick={() => handleQuickAction('shopping')}
                          className="w-full px-3 py-2.5 rounded-lg text-left hover:bg-[#1b1b1b] transition-colors flex items-center gap-2.5 text-[13px] text-zinc-200"
                        >
                          <ShoppingBag size={14} className="text-zinc-400" />
                          <span>Shopping research</span>
                        </button>
                        <button
                          onClick={() => handleQuickAction('web')}
                          className="w-full px-3 py-2.5 rounded-lg text-left hover:bg-[#1b1b1b] transition-colors flex items-center gap-2.5 text-[13px] text-zinc-200"
                        >
                          <Search size={14} className="text-zinc-400" />
                          <span>Web search</span>
                        </button>
                        <button
                          onClick={() => handleQuickAction('more')}
                          className="w-full px-3 py-2.5 rounded-lg text-left hover:bg-[#1b1b1b] transition-colors flex items-center gap-2.5 text-[13px] text-zinc-200"
                        >
                          <Ellipsis size={14} className="text-zinc-400" />
                          <span>More</span>
                        </button>
                      </div>

                      <div className="h-px bg-[#2a2a2a]" />
                      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Modes</div>

                      <button
                        onClick={() => {
                          setDevMode(v => !v);
                        }}
                        className="w-full px-4 py-2.5 text-left hover:bg-[#1a1a1a] transition-colors flex items-center justify-between text-sm"
                      >
                        <span className="flex items-center gap-2 text-zinc-200"><Code2 size={14} /> Developer mode</span>
                        {devMode && <Check size={14} className="text-[#ff7a00]" />}
                      </button>
                      <button
                        onClick={() => {
                          setWebAssistMode(v => !v);
                        }}
                        className="w-full px-4 py-2.5 text-left hover:bg-[#1a1a1a] transition-colors flex items-center justify-between text-sm"
                      >
                        <span className="flex items-center gap-2 text-zinc-200"><Globe size={14} /> Web assist fallback</span>
                        {webAssistMode && <Check size={14} className="text-[#4ade80]" />}
                      </button>
                      <button
                        onClick={() => {
                          setConciseMode(v => !v);
                        }}
                        className="w-full px-4 py-2.5 text-left hover:bg-[#1a1a1a] transition-colors flex items-center justify-between text-sm"
                      >
                        <span className="flex items-center gap-2 text-zinc-200"><Sparkles size={14} /> Concise replies</span>
                        {conciseMode && <Check size={14} className="text-[#60a5fa]" />}
                      </button>
                      <button
                        onClick={() => {
                          setPerformanceMode(v => !v);
                        }}
                        className="w-full px-4 py-2.5 text-left hover:bg-[#1a1a1a] transition-colors flex items-center justify-between text-sm"
                      >
                        <span className="flex items-center gap-2 text-zinc-200"><Gauge size={14} /> Performance mode</span>
                        {performanceMode && <Check size={14} className="text-amber-400" />}
                      </button>
                      <div className="h-px bg-[#2a2a2a]" />
                      <button
                        onClick={() => {
                          handleNewChat();
                          setShowModeMenu(false);
                        }}
                        className="w-full px-4 py-3 text-left hover:bg-[#1a1a1a] transition-colors text-sm text-zinc-300"
                      >
                        Start new chat
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <textarea
                ref={composerInputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                  if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    setShowCommandPalette(true);
                  }
                }}
                placeholder="Ask Cognira... (type / for commands)"
                aria-label="Message composer"
                className="w-full bg-transparent p-5 pl-16 pr-32 min-h-[60px] max-h-48 overflow-y-auto text-zinc-200 placeholder-zinc-700 focus:outline-none resize-none text-sm font-medium"
                rows={1}
              />
              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach files"
                  className="p-2.5 rounded-xl transition-all text-zinc-600 hover:text-white hover:bg-white/5"
                  title="Attach files"
                >
                  <Upload size={20} />
                </button>
                <button
                  onClick={pinCurrentPrompt}
                  aria-label="Pin current prompt"
                  className="p-2.5 rounded-xl transition-all text-zinc-600 hover:text-white hover:bg-white/5"
                  title="Pin this prompt"
                >
                  <Pin size={20} />
                </button>
                <button 
                  onClick={toggleVoiceInput}
                  aria-label="Toggle voice input"
                  className={cn(
                    "p-2.5 rounded-xl transition-all",
                    isRecording ? "bg-red-500/10 text-red-500 animate-pulse" : "text-zinc-600 hover:text-white hover:bg-white/5"
                  )}
                  title="Voice Input"
                >
                  <Mic size={20} />
                </button>
                <button 
                  onClick={() => { void handleSendMessage(); }}
                  aria-label="Send message"
                  disabled={!input.trim() || isLoading}
                  className={cn(
                    "p-2.5 rounded-xl transition-all",
                    input.trim() && !isLoading 
                      ? (devMode ? "bg-[#ff7a00] text-black shadow-lg shadow-[#ff7a00]/20" : "bg-white text-black hover:bg-zinc-200") 
                      : "bg-zinc-900 text-zinc-700 cursor-not-allowed border border-[#2a2a2a]"
                  )}
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
            <div className="mt-2 min-h-5 flex items-center justify-between gap-3 px-2">
              <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{personas.find(p => p.id === selectedPersonaId)?.name || 'Balanced'}</span>
              {devMode && (
                <button onClick={() => setDevMode(false)} className="text-[10px] font-bold uppercase tracking-widest text-[#ff7a00] hover:opacity-80">Developer mode</button>
              )}
              {webAssistMode && (
                <button onClick={() => setWebAssistMode(false)} className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 hover:opacity-80">Web assist</button>
              )}
              {conciseMode && (
                <button onClick={() => setConciseMode(false)} className="text-[10px] font-bold uppercase tracking-widest text-sky-400 hover:opacity-80">Concise</button>
              )}
              {performanceMode && (
                <button onClick={() => setPerformanceMode(false)} className="text-[10px] font-bold uppercase tracking-widest text-amber-400 hover:opacity-80">Performance</button>
              )}
              </div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-600">
                {hasDraft && <span className="text-zinc-500">Draft</span>}
                <span>{inputCharCount} chars</span>
              </div>
            </div>

            {isSlashMode && (
              <div className="mt-2 rounded-xl border border-[#2a2a2a] bg-[#0f0f0f] p-2">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Slash Commands</div>
                <div className="space-y-1">
                  {visibleSlashCommands.length > 0 ? (
                    visibleSlashCommands.map((item) => (
                      <button
                        key={item.command}
                        onClick={() => setInput(`${item.command} `)}
                        className="w-full text-left px-2.5 py-2 rounded-md hover:bg-[#181818] border border-transparent hover:border-[#252525] transition-colors"
                      >
                        <div className="text-[11px] text-zinc-200 font-semibold">{item.command}</div>
                        <div className="text-[10px] text-zinc-500">{item.description}</div>
                      </button>
                    ))
                  ) : (
                    <div className="px-2 py-2 text-[11px] text-zinc-500">No commands found. Try `/help`.</div>
                  )}
                </div>
              </div>
            )}

            {(pinnedPrompts.length > 0 || attachedFiles.length > 0 || citations.length > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
                {pinnedPrompts.slice(0, 3).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setInput(prompt)}
                    className="px-2.5 py-1 rounded-full text-[10px] bg-[#111111] border border-[#2a2a2a] text-zinc-400 hover:text-white hover:border-zinc-600"
                  >
                    {prompt.length > 40 ? `${prompt.slice(0, 40)}...` : prompt}
                  </button>
                ))}
                {attachedFiles.slice(0, 2).map((file) => (
                  <span key={`${file.filename}-${file.path || ''}`} className="px-2 py-1 rounded-full text-[10px] bg-[#0f141f] border border-[#273249] text-sky-300">
                    {file.filename}
                  </span>
                ))}
                {citations.slice(0, 1).map((citation, idx) => (
                  <span key={`${citation.filename}-${citation.chunk}-${idx}`} className="px-2 py-1 rounded-full text-[10px] bg-[#131313] border border-[#2a2a2a] text-zinc-400">
                    Source: {citation.filename} · chunk {citation.chunk}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-center gap-6 text-[10px] font-bold text-zinc-700 uppercase tracking-widest">
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                ENTER TO SEND
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                SHIFT + ENTER FOR NEWLINE
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                MODEL: {model}
              </div>
              <button
                onClick={() => setShowCommandPalette(true)}
                className="flex items-center gap-1.5 hover:text-zinc-500 transition-colors"
              >
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                CTRL/CMD + K
              </button>
              <button
                onClick={() => setShowShortcutsPanel(true)}
                className="flex items-center gap-1.5 hover:text-zinc-500 transition-colors"
              >
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                SHORTCUTS
              </button>
            </div>
          </div>
        </div>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {isLoading ? `${thinkingLabel}. ${thinkingStatus}.` : 'Idle.'}
        </div>

        <AnimatePresence>
          {showCommandPalette && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.14 }}
                className="fixed inset-0 bg-black/55 z-40"
                onClick={() => setShowCommandPalette(false)}
              />
              <motion.div
                initial={shouldReduceMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16 }}
                className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,680px)] rounded-2xl border border-[#2b2b2b] bg-[#101011] shadow-2xl"
              >
                <div className="p-3 border-b border-[#262626]">
                  <input
                    ref={paletteInputRef}
                    value={paletteQuery}
                    onChange={(e) => setPaletteQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setShowCommandPalette(false);
                        return;
                      }

                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (visiblePaletteItems.length > 0) {
                          setPaletteCursor((prev) => (prev + 1) % visiblePaletteItems.length);
                        }
                        return;
                      }

                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (visiblePaletteItems.length > 0) {
                          setPaletteCursor((prev) => (prev - 1 + visiblePaletteItems.length) % visiblePaletteItems.length);
                        }
                        return;
                      }

                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (visiblePaletteItems[safePaletteCursor]) {
                          visiblePaletteItems[safePaletteCursor].action();
                        }
                      }
                    }}
                    placeholder="Search actions, sessions, settings..."
                    aria-label="Quick action search"
                    className="w-full bg-[#0d0d0e] border border-[#262626] rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-[#ff7a00]/35"
                  />
                  <div className="mt-2 text-[10px] text-zinc-500 uppercase tracking-widest">Quick Navigator · Ctrl/Cmd + K</div>
                </div>

                <div className="max-h-[52vh] overflow-y-auto p-2">
                  {visiblePaletteItems.length > 0 ? (
                    <div className="space-y-3">
                      {groupedPaletteItems.map((group) => (
                        <div key={group.key} className="space-y-1.5">
                          <div className="px-2 text-[10px] uppercase tracking-widest text-zinc-600">{group.label}</div>
                          {group.items.map((item) => {
                            const globalIndex = visiblePaletteItems.findIndex((entry) => entry.id === item.id);
                            return (
                              <button
                                key={item.id}
                                onClick={item.action}
                                className={cn(
                                  'w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-start justify-between gap-2',
                                  globalIndex === safePaletteCursor
                                    ? 'border-[#ff7a00]/35 bg-[#1a130d]'
                                    : 'border-transparent hover:border-[#2a2a2a] hover:bg-[#181818]'
                                )}
                              >
                                <div>
                                  <div className="text-sm text-zinc-200 font-medium">{item.title}</div>
                                  <div className="text-[11px] text-zinc-500">{item.subtitle}</div>
                                </div>
                                {item.hint && (
                                  <span className="text-[10px] uppercase tracking-widest text-zinc-600 border border-[#2a2a2a] rounded-md px-1.5 py-0.5">
                                    {item.hint}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-8 text-center text-zinc-500 text-sm">No matches found.</div>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showShortcutsPanel && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/55 z-40"
                onClick={() => setShowShortcutsPanel(false)}
              />
              <motion.div
                initial={shouldReduceMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16 }}
                className="fixed top-24 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,560px)] rounded-2xl border border-[#2b2b2b] bg-[#101011] shadow-2xl"
              >
                <div className="px-4 py-3 border-b border-[#262626] flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">Keyboard Shortcuts</div>
                    <div className="text-[11px] text-zinc-500">Speed up navigation and actions</div>
                  </div>
                  <button
                    onClick={() => setShowShortcutsPanel(false)}
                    className="p-2 rounded-md text-zinc-400 hover:text-white hover:bg-[#1a1a1a]"
                    aria-label="Close shortcuts panel"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    ['Ctrl/Cmd + K', 'Open quick navigator'],
                    ['Ctrl/Cmd + /', 'Open shortcuts panel'],
                    ['Ctrl/Cmd + ,', 'Open settings'],
                    ['Alt + 1', 'Focus composer'],
                    ['Alt + 2', 'Focus history search'],
                    ['Alt + N', 'Start new chat'],
                    ['Alt + B', 'Toggle sidebar'],
                    ['Enter', 'Send message'],
                    ['Shift + Enter', 'New line in composer']
                  ].map(([keys, desc]) => (
                    <div key={keys} className="rounded-lg border border-[#252525] bg-[#121212] px-3 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-[11px] text-zinc-300">{desc}</span>
                      <span className="text-[10px] uppercase tracking-widest text-zinc-500 border border-[#2a2a2a] rounded-md px-2 py-0.5">{keys}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showSettingsPanel && (
            <>
              <motion.div
                initial={shouldReduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16 }}
                className="fixed inset-0 bg-black/55 z-40"
                onClick={() => setShowSettingsPanel(false)}
              />
              <motion.aside
                initial={shouldReduceMotion ? false : { x: 360, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { x: 360, opacity: 0 }}
                transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 26 }}
                className="fixed top-0 right-0 h-full w-[min(92vw,360px)] z-50 bg-[#0f0f10] border-l border-[#262626] shadow-2xl"
              >
                <div className="h-full flex flex-col">
                  <div className="px-4 py-3 border-b border-[#262626] flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-zinc-100">Settings</div>
                      <div className="text-[11px] text-zinc-500">Customize your Cognira workspace</div>
                    </div>
                    <button
                      onClick={() => setShowSettingsPanel(false)}
                      className="p-2 rounded-md text-zinc-400 hover:text-white hover:bg-[#1a1a1a]"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div className="rounded-xl border border-[#252525] bg-[#121212] p-3 space-y-3">
                      <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold">Layout</div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-zinc-300">Density</span>
                          <select
                            value={densityMode}
                            onChange={(e) => setDensityMode(e.target.value as DensityMode)}
                            className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-md px-2 py-1 text-xs text-zinc-200"
                          >
                            <option value="comfortable">Comfortable</option>
                            <option value="compact">Compact</option>
                          </select>
                        </div>
                        <label className="flex items-center justify-between text-sm text-zinc-300">
                          <span>Slash commands in composer</span>
                          <span className="text-[11px] text-emerald-400 font-medium">Enabled</span>
                        </label>
                        <label className="flex items-center justify-between text-sm text-zinc-300">
                          <span>Show sidebar navigation</span>
                          <input type="checkbox" checked={showSidebar} onChange={(e) => setShowSidebar(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between text-sm text-zinc-300">
                          <span>Show top thinking badge</span>
                          <input type="checkbox" checked={showTopThinkingBadge} onChange={(e) => setShowTopThinkingBadge(e.target.checked)} />
                        </label>
                        <label className="flex items-center justify-between text-sm text-zinc-300">
                          <span>Show system health card</span>
                          <input type="checkbox" checked={showSystemHealthCard} onChange={(e) => setShowSystemHealthCard(e.target.checked)} />
                        </label>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#252525] bg-[#121212] p-3 space-y-3">
                      <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold">Behavior</div>
                      <label className="flex items-center justify-between text-sm text-zinc-300">
                        <span>Performance mode</span>
                        <input type="checkbox" checked={performanceMode} onChange={(e) => setPerformanceMode(e.target.checked)} />
                      </label>
                      <button
                        onClick={() => {
                          setShowSettingsPanel(false);
                          setShowShortcutsPanel(true);
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg border border-[#2a2a2a] bg-[#161616] text-zinc-300 text-xs hover:bg-[#1c1c1c]"
                      >
                        View keyboard shortcuts
                      </button>
                      <div className="text-[11px] text-zinc-500">Performance mode reduces rendering work and polling frequency.</div>
                    </div>

                    <div className="rounded-xl border border-[#252525] bg-[#121212] p-3 space-y-3">
                      <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold">Data</div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={exportUiSettings}
                          className="px-3 py-1.5 rounded-lg bg-[#171717] border border-[#2a2a2a] text-zinc-200 text-xs inline-flex items-center gap-1.5 hover:bg-[#1e1e1e]"
                        >
                          <Save size={13} /> Copy settings JSON
                        </button>
                        <button
                          onClick={resetUiSettings}
                          className="px-3 py-1.5 rounded-lg bg-[#171717] border border-[#2a2a2a] text-zinc-200 text-xs hover:bg-[#1e1e1e]"
                        >
                          Reset UI defaults
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
