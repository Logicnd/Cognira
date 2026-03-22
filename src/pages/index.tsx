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
  Image,
  FlaskConical,
  ShoppingBag,
  Search,
  Ellipsis
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'framer-motion';
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
  const [model, setModel] = useState('openai (Cloud)');
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
  const [thinkingStatus, setThinkingStatus] = useState('Thinking...');
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [hasReceivedContent, setHasReceivedContent] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
      if (storedDevMode !== null) setDevMode(storedDevMode === 'true');
      if (storedWebAssist !== null) setWebAssistMode(storedWebAssist === 'true');
      if (storedConcise !== null) setConciseMode(storedConcise === 'true');
    } catch (error) {
      console.error('Failed to load mode preferences', error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('cognira_mode_dev', String(devMode));
      localStorage.setItem('cognira_mode_web', String(webAssistMode));
      localStorage.setItem('cognira_mode_concise', String(conciseMode));
    } catch (error) {
      console.error('Failed to save mode preferences', error);
    }
  }, [devMode, webAssistMode, conciseMode]);

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
    const interval = setInterval(fetchStats, LOW_RESOURCE_MODE ? 20000 : 5000);
    return () => clearInterval(interval);
  }, []);

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

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const trimmedInput = input.trim();
    const userMessage: Message = { role: 'user', content: trimmedInput };
    const assistantMessage: Message = { role: 'assistant', content: '' };
    const nextMessages = [...messages, userMessage];
    const modeInstructions: string[] = [];

    if (devMode) {
      modeInstructions.push('Developer mode is enabled. Prefer technical, implementation-focused, and explicit reasoning when useful.');
    }
    if (conciseMode) {
      modeInstructions.push('Keep responses concise and practical unless the user explicitly asks for detailed output.');
    }
    if (webAssistMode) {
      modeInstructions.push('If cloud LLM is unavailable, provide the best possible web-assisted answer with clear source links.');
    }

    const apiMessages: ApiMessage[] = modeInstructions.length > 0
      ? [{ role: 'system', content: modeInstructions.join(' ') }, ...nextMessages]
      : nextMessages;

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput('');
    setIsLoading(true);
    setHasReceivedContent(false);
    setThinkingStatus('Thinking...');
    setThinkingSeconds(0);

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
      setThinkingSeconds(0);
      // Refresh session titles
      try {
        const response = await axios.get(`${API_URL}/sessions`);
        setSessions(response.data.sessions || []);
      } catch (e) {
        console.error("Failed to refresh sessions", e);
      }
    }
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

  return (
    <div className="flex h-screen bg-[#000000] text-zinc-100 font-sans overflow-hidden">
      <Head>
        <title>Cognira | Local AI Intelligence</title>
      </Head>

      {/* Developer Mode Banner */}
      <AnimatePresence>
        {devMode && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 28, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
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
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
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
              <button 
                onClick={handleNewChat}
                className="p-2 hover:bg-[#1a1a1a] rounded-md transition-colors text-zinc-500 hover:text-white"
                title="New Chat"
              >
                <Plus size={16} />
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
                    type="text"
                    placeholder="Search history..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
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
        devMode && "pt-[28px]"
      )}>
        {/* Top Header */}
        <header className="h-14 border-b border-[#2a2a2a] flex items-center justify-between px-6 bg-black/80 backdrop-blur-xl sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowSidebar(!showSidebar)}
              className="p-2 -ml-2 hover:bg-[#1a1a1a] rounded-md transition-colors text-zinc-500 hover:text-white"
            >
              <ChevronRight className={cn("transition-transform duration-300", showSidebar && "rotate-180")} size={18} />
            </button>
            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
              <Info size={12} />
              <span>Cognira V1.0</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {isLoading && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-[#ff7a00] animate-pulse">
                <Activity size={12} />
                <span>THINKING...</span>
              </div>
            )}
            <button className="p-2 hover:bg-[#1a1a1a] rounded-md transition-colors text-zinc-500 hover:text-white">
              <Settings size={18} />
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <div className="max-w-3xl mx-auto px-6 py-12 space-y-12">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-8">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
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
              messages.map((msg, i) => (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={i} 
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
                          components={markdownComponents}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      ) : (isLoading && i === messages.length - 1 ? (
                        <div className="space-y-2">
                          <div className="text-xs text-zinc-500 font-medium">{thinkingLabel}</div>
                          <div className="text-sm text-zinc-300">{thinkingStatus}</div>
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
                    </div>
                    {msg.role === 'assistant' && msg.content && (
                      <div className="flex items-center gap-3 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => copyToClipboard(msg.content)}
                          className="text-[10px] font-bold text-zinc-600 hover:text-zinc-400 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
                        >
                          <Download size={12} /> Copy
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Bar */}
        <div className="p-8 bg-gradient-to-t from-black via-black to-transparent">
          <div className="max-w-3xl mx-auto relative">
            <div className={cn(
              "relative group bg-[#111111] border rounded-2xl transition-all duration-300",
              devMode ? "border-[#ff7a00]/30 focus-within:border-[#ff7a00] focus-within:ring-4 focus-within:ring-[#ff7a00]/5" : "border-[#2a2a2a] focus-within:border-zinc-700 focus-within:ring-4 focus-within:ring-white/5"
            )}>
              <div ref={modeMenuRef} className="absolute left-3 bottom-3 z-20">
                <button
                  onClick={() => setShowModeMenu(prev => !prev)}
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
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.98 }}
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
                          <Image size={14} className="text-zinc-400" />
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
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                  if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleNewChat();
                  }
                }}
                placeholder="Ask Cognira..."
                className="w-full bg-transparent p-5 pl-16 pr-32 min-h-[60px] max-h-48 overflow-y-auto text-zinc-200 placeholder-zinc-700 focus:outline-none resize-none text-sm font-medium"
                rows={1}
              />
              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                <button 
                  onClick={toggleVoiceInput}
                  className={cn(
                    "p-2.5 rounded-xl transition-all",
                    isRecording ? "bg-red-500/10 text-red-500 animate-pulse" : "text-zinc-600 hover:text-white hover:bg-white/5"
                  )}
                  title="Voice Input"
                >
                  <Mic size={20} />
                </button>
                <button 
                  onClick={handleSendMessage}
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
            <div className="mt-2 h-5 flex items-center justify-start gap-2 px-2">
              {devMode && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#ff7a00]">Developer mode</span>
              )}
              {webAssistMode && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Web assist</span>
              )}
              {conciseMode && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Concise</span>
              )}
            </div>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
