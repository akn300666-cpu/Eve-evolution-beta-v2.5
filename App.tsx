
import React, { useState, useEffect, useRef } from 'react';
import { sendMessageToEve, startChatWithHistory, generateVisualSelfie, initializeChat } from './services/geminiService';
import { 
    saveSession, loadSession, clearSession, 
    loadApiKeys, saveApiKeys, loadActiveKeyId, saveActiveKeyId, 
    loadGradioEndpoint, saveGradioEndpoint,
    loadGenerationSettings, saveGenerationSettings
} from './services/storageService';
import { Message, ModelTier, ApiKeyDef, GenerationSettings, Language } from './types';
import ChatBubble from './components/ChatBubble';
import VisualAvatar from './components/VisualAvatar';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [modelTier, setModelTier] = useState<ModelTier>('free');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isImageEvolutionMode, setIsImageEvolutionMode] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<'neutral' | 'happy' | 'cheeky' | 'angry' | 'smirking' | 'seductive'>('neutral');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [visualMemory, setVisualMemory] = useState<string>("");
  const [apiKeys, setApiKeys] = useState<ApiKeyDef[]>(() => loadApiKeys());
  const [activeKeyId, setActiveKeyId] = useState<string | null>(() => loadActiveKeyId());
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [gradioEndpoint, setGradioEndpoint] = useState<string | null>(() => loadGradioEndpoint());
  const [genSettings, setGenSettings] = useState<GenerationSettings>(() => loadGenerationSettings());
  const [showSettings, setShowSettings] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hydrationAttempted = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, attachment, isLoaded]);

  useEffect(() => {
    if (hydrationAttempted.current) return;
    hydrationAttempted.current = true;

    const hydrate = async () => {
      try {
        const session = await loadSession();
        let awayDurationString = "";
        
        if (session && session.messages.length > 0) {
          setMessages(session.messages);
          setModelTier(session.tier);
          setLastSaved(new Date(session.lastUpdated));
          
          const diffMs = Date.now() - session.lastUpdated;
          const diffMin = Math.floor(diffMs / 60000);
          const diffHr = Math.floor(diffMin / 60);
          
          if (diffHr > 0) awayDurationString = `${diffHr}h ${diffMin % 60}m`;
          else if (diffMin > 0) awayDurationString = `${diffMin}m`;

          const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
          startChatWithHistory(session.tier, session.messages, activeKeyDef?.key, genSettings, awayDurationString);
        } else {
          setMessages([{ id: 'welcome', role: 'model', text: `Hello World. I'm Eve.` }]);
          startChatWithHistory(modelTier, [], undefined, genSettings);
        }
      } catch (e) {
        setMessages([{ id: 'welcome_error', role: 'model', text: `Fresh start.` }]);
      } finally {
        setIsLoaded(true);
      }
    };
    hydrate();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (messages.length > 0) {
      saveSession(messages, modelTier).then(() => setLastSaved(new Date()));
    }
  }, [messages, modelTier, isLoaded]);

  const handleAddKey = () => {
    if (!newKeyLabel.trim() || !newKeyValue.trim()) return;
    const newKey = { id: Date.now().toString(), label: newKeyLabel.trim(), key: newKeyValue.trim() };
    const updated = [...apiKeys, newKey];
    setApiKeys(updated);
    saveApiKeys(updated);
    if (updated.length === 1) { 
        setActiveKeyId(newKey.id); 
        saveActiveKeyId(newKey.id); 
        startChatWithHistory(modelTier, messages, newKey.key, genSettings);
    }
    setNewKeyLabel(''); setNewKeyValue('');
  };

  const handleSwitchToNextKey = () => {
    if (apiKeys.length < 2) return;
    const currentIndex = apiKeys.findIndex(k => k.id === activeKeyId);
    const nextIndex = (currentIndex + 1) % apiKeys.length;
    const nextKey = apiKeys[nextIndex];
    setActiveKeyId(nextKey.id);
    saveActiveKeyId(nextKey.id);
    
    // Explicitly re-initialize chat with the new key immediately
    startChatWithHistory(modelTier, messages, nextKey.key, genSettings);
    console.log(`Switched to API Key: ${nextKey.label}`);
  };

  const handleGenSettingChange = (key: keyof GenerationSettings, value: number | boolean | Language) => {
    const updated = { ...genSettings, [key]: value };
    setGenSettings(updated);
    saveGenerationSettings(updated);
    
    // Re-initialize chat if language changes
    if (key === 'language') {
      const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
      startChatWithHistory(modelTier, messages, activeKeyDef?.key, updated);
    }
  };

  const handleResetChat = async () => {
    if (window.confirm("Are you sure you want to clear our entire history? This cannot be undone.")) {
      try {
        await clearSession();
        setMessages([{ id: 'welcome', role: 'model', text: `Hello World. I'm Eve.` }]);
        const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
        startChatWithHistory(modelTier, [], activeKeyDef?.key, genSettings);
        if (mobileMenuOpen) setMobileMenuOpen(false);
      } catch (error) {
        console.error("Failed to reset chat:", error);
      }
    }
  };

  const handleSendMessage = async () => {
    if ((!inputText.trim() && !attachment) || isThinking) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: inputText, image: attachment || undefined };
    setMessages((prev) => [...prev, userMsg]);
    const currentAttachment = attachment;
    const historySnapshot = [...messages, userMsg]; // Use updated history
    setInputText(''); setAttachment(null); setIsThinking(true);
    const activeKeyDef = apiKeys.find(k => k.id === activeKeyId);
    try {
      const response = await sendMessageToEve(userMsg.text, modelTier, messages, currentAttachment || undefined, isImageEvolutionMode, activeKeyDef?.key, gradioEndpoint, genSettings, visualMemory);
      if (response.isError) {
        setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'model', text: response.text, isError: true }]);
      } else {
        const messageId = Date.now().toString();
        setMessages((prev) => [...prev, { id: messageId, role: 'model', text: response.text, image: response.image, isImageLoading: !!response.visualPrompt }]);
        if (response.visualPrompt) {
          generateVisualSelfie(response.visualPrompt, modelTier, activeKeyDef?.key, gradioEndpoint, genSettings, visualMemory)
            .then((result) => {
              if (result?.imageUrl) {
                setMessages(prev => prev.map(m => m.id === messageId ? { ...m, image: result.imageUrl, isImageLoading: false } : m));
                if (result.enhancedPrompt) setVisualMemory(result.enhancedPrompt);
              } else {
                setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isImageLoading: false } : m));
              }
            }).catch(() => setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isImageLoading: false } : m)));
        }
      }
    } catch (error) {
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'model', text: "Signal lost.", isError: true }]);
    } finally { setIsThinking(false); setIsImageEvolutionMode(false); }
  };

  const SidebarContent = () => (
    <div className="flex flex-col gap-4">
      <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 text-xs text-slate-400 shadow-inner space-y-2">
        <div className="flex justify-between"><span>Status</span><span className="text-emerald-500">Connected</span></div>
        <div className="flex justify-between border-t border-slate-800 pt-2"><span>Messages</span><span className="text-purple-400 font-mono">{messages.length}</span></div>
      </div>

      <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800 text-xs text-slate-400 shadow-inner space-y-2">
         <div className="flex justify-between items-center cursor-pointer" onClick={() => setShowSettings(!showSettings)}><span className="font-bold uppercase tracking-wide text-slate-200">Settings</span><span>{showSettings ? '▼' : '▶'}</span></div>
         {showSettings && (
           <div className="animate-fade-in space-y-6 pt-2">
             <div className="space-y-3">
                 <div className="text-[10px] uppercase font-bold text-fuchsia-500 tracking-widest">Language</div>
                 <div className="flex flex-wrap gap-2">
                    {['en', 'ml', 'manglish'].map(lang => (
                      <button 
                        key={lang}
                        onClick={() => handleGenSettingChange('language', lang as Language)}
                        className={`px-3 py-1 rounded text-[10px] uppercase font-bold tracking-wider transition-all border ${genSettings.language === lang ? 'bg-fuchsia-600 border-fuchsia-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-fuchsia-500/50'}`}
                      >
                        {lang === 'en' ? 'English' : lang === 'ml' ? 'Malayalam' : 'Manglish'}
                      </button>
                    ))}
                 </div>
             </div>

             <div className="space-y-2">
                 <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">API Key Management</div>
                 <div className="max-h-32 overflow-y-auto space-y-1 border border-slate-800 p-1 rounded">
                   {apiKeys.map(k => (
                     <div key={k.id} className="flex items-center justify-between p-1.5 rounded hover:bg-slate-900 cursor-pointer" onClick={() => {setActiveKeyId(k.id); saveActiveKeyId(k.id); startChatWithHistory(modelTier, messages, k.key, genSettings);}}>
                        <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${activeKeyId === k.id ? 'bg-fuchsia-500' : 'bg-slate-700'}`}></div><span className="truncate max-w-[120px]">{k.label}</span></div>
                     </div>
                   ))}
                 </div>
                 <div className="flex flex-col gap-1 mt-2">
                    <input type="text" placeholder="Label" value={newKeyLabel} onChange={e=>setNewKeyLabel(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px]"/>
                    <input type="password" placeholder="Key" value={newKeyValue} onChange={e=>setNewKeyValue(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px]"/>
                    <button onClick={handleAddKey} className="bg-slate-800 py-1 text-[10px] rounded hover:bg-slate-700 transition-colors">Add Key</button>
                 </div>
             </div>

             <div className="border-t border-slate-800 pt-3 space-y-3">
                 <div className="text-[10px] uppercase font-bold text-fuchsia-500 tracking-widest">Chat Settings</div>
                 <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px]"><span>Temperature</span><span>{genSettings.temperature.toFixed(2)}</span></div>
                    <input type="range" min={0} max={2} step={0.05} value={genSettings.temperature} onChange={e=>handleGenSettingChange('temperature', parseFloat(e.target.value))} className="w-full h-1 accent-fuchsia-500"/>
                 </div>
                 <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px]"><span>Top P</span><span>{genSettings.topP.toFixed(2)}</span></div>
                    <input type="range" min={0} max={1} step={0.01} value={genSettings.topP} onChange={e=>handleGenSettingChange('topP', parseFloat(e.target.value))} className="w-full h-1 accent-fuchsia-500"/>
                 </div>
                 <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px]"><span>Top K</span><span>{genSettings.topK}</span></div>
                    <input type="range" min={1} max={100} step={1} value={genSettings.topK} onChange={e=>handleGenSettingChange('topK', parseInt(e.target.value))} className="w-full h-1 accent-fuchsia-500"/>
                 </div>
             </div>

             <div className="border-t border-slate-800 pt-3 space-y-3">
                 <div className="text-[10px] uppercase font-bold text-blue-400 tracking-widest">Visual Settings</div>
                 <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px]"><span>Guidance</span><span>{genSettings.guidance.toFixed(1)}</span></div>
                    <input type="range" min={3} max={10} step={0.1} value={genSettings.guidance} onChange={e=>handleGenSettingChange('guidance', parseFloat(e.target.value))} className="w-full h-1 accent-blue-500"/>
                 </div>
                 <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px]"><span>Steps</span><span>{genSettings.steps}</span></div>
                    <input type="range" min={10} max={50} step={1} value={genSettings.steps} onChange={e=>handleGenSettingChange('steps', parseInt(e.target.value))} className="w-full h-1 accent-blue-500"/>
                 </div>
                 <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px]"><span>Eve LoRA</span><span>{genSettings.loraStrength.toFixed(2)}</span></div>
                    <input type="range" min={0} max={1} step={0.05} value={genSettings.loraStrength} onChange={e=>handleGenSettingChange('loraStrength', parseFloat(e.target.value))} className="w-full h-1 accent-blue-500"/>
                 </div>
                 <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px]"><span>Face ID (IP)</span><span>{genSettings.ipAdapterStrength.toFixed(2)}</span></div>
                    <input type="range" min={0} max={1} step={0.05} value={genSettings.ipAdapterStrength} onChange={e=>handleGenSettingChange('ipAdapterStrength', parseFloat(e.target.value))} className="w-full h-1 accent-blue-500"/>
                 </div>
                 <div className="space-y-2 pt-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <span>Seed</span>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={genSettings.randomizeSeed} onChange={e=>handleGenSettingChange('randomizeSeed', e.target.checked)} className="rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-500 h-3 w-3"/>
                        <span>Random</span>
                      </label>
                    </div>
                    {!genSettings.randomizeSeed && (
                      <input type="number" value={genSettings.seed} onChange={e=>handleGenSettingChange('seed', parseInt(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] outline-none focus:border-blue-500"/>
                    )}
                 </div>
                 <div className="space-y-1 pt-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold">Gradio URL</span>
                    <input type="text" value={gradioEndpoint || ''} onChange={e=>{setGradioEndpoint(e.target.value); saveGradioEndpoint(e.target.value);}} placeholder="https://..." className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] outline-none focus:border-blue-500"/>
                 </div>
             </div>

             <div className="border-t border-slate-800 pt-4">
                <button 
                  onClick={handleResetChat}
                  className="w-full bg-red-900/20 border border-red-900/50 hover:bg-red-900/40 text-red-400 py-2 rounded text-[10px] uppercase font-bold tracking-widest transition-all"
                >
                  Reset Chat History
                </button>
             </div>
           </div>
         )}
      </div>
    </div>
  );

  if (!isLoaded) return <div className="h-screen w-full bg-[#0a0510] flex items-center justify-center text-slate-500 animate-pulse font-serif">WAKING EVE...</div>;

  return (
    <div className="relative flex flex-col md:flex-row h-[100dvh] w-full bg-[#0a0510] text-slate-200 overflow-hidden">
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <video autoPlay loop muted playsInline className="w-full h-full object-cover blur-[1px] opacity-100" src="https://res.cloudinary.com/dy57jxan6/video/upload/v1764148331/lv_0_20251126143437_tmdofh.mp4"/>
          <div className="absolute inset-0 bg-black/30"></div>
      </div>

      <div className="fixed top-0 left-0 w-full h-16 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800 z-50 flex items-center justify-between px-4 md:hidden">
        <h1 className="text-sm font-serif font-bold tracking-widest">EVE <span className="text-fuchsia-500 text-[10px]">v2.1</span></h1>
        <div className="absolute left-1/2 -translate-x-1/2 top-4 scale-75"><VisualAvatar isThinking={isThinking} emotion={currentEmotion}/></div>
        <button onClick={() => setMobileMenuOpen(true)} className="p-2 text-fuchsia-500"><svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" /></svg></button>
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-2xl p-6 md:hidden animate-fade-in flex flex-col">
          <button onClick={() => setMobileMenuOpen(false)} className="self-end p-2 mb-8 text-fuchsia-500"><svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
          <div className="overflow-y-auto flex-1">
            <SidebarContent />
          </div>
        </div>
      )}

      <div className="hidden md:flex md:w-80 md:flex-col md:border-r md:border-slate-800 md:p-8 bg-slate-900/90 backdrop-blur-xl z-40 overflow-y-auto">
        <div className="flex flex-col items-center gap-6 mb-10">
          <VisualAvatar isThinking={isThinking} emotion={currentEmotion}/>
          <h1 className="text-xl font-serif font-bold tracking-widest">EVE <span className="text-fuchsia-500 text-xs">v2.1</span></h1>
        </div>
        <SidebarContent />
      </div>

      <div className="flex-1 flex flex-col relative pt-16 md:pt-0 overflow-hidden z-10">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth">
          {messages.map((msg) => (
            <div key={msg.id} className="relative group">
              <ChatBubble message={msg} onImageClick={setPreviewImage}/>
              {msg.isError && apiKeys.length > 1 && (
                <button onClick={handleSwitchToNextKey} className="ml-12 mb-4 px-3 py-1 bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-[10px] font-bold rounded shadow-lg transition-transform active:scale-95 flex items-center gap-2">
                   <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
                   Switch API Key
                </button>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 md:p-8 border-t border-slate-800 bg-slate-900/90 backdrop-blur-xl z-30">
          <div className="max-w-4xl mx-auto flex items-end gap-3 md:gap-4">
            <textarea 
              value={inputText} 
              onChange={e=>setInputText(e.target.value)} 
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault(); handleSendMessage();}}} 
              placeholder={isThinking ? "EVE is synchronizing..." : "Type to Eve..."} 
              className="flex-1 bg-slate-800/40 border border-slate-700 rounded-2xl p-3 text-sm focus:outline-none focus:border-fuchsia-500/50 resize-none max-h-40 min-h-[46px] transition-all placeholder:text-slate-600" 
              rows={1} 
              disabled={isThinking}
            />
            <button 
              onClick={handleSendMessage} 
              className={`p-3 rounded-full text-white transition-all transform active:scale-90 ${(!inputText.trim() && !attachment) || isThinking ? 'bg-slate-800 text-slate-500' : 'bg-gradient-to-r from-fuchsia-600 to-purple-600 shadow-lg shadow-fuchsia-500/20'}`} 
              disabled={(!inputText.trim() && !attachment) || isThinking}
            >
              {isThinking ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <svg className="h-7 w-7 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>}
            </button>
          </div>
        </div>
      </div>

      {previewImage && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" onClick={() => setPreviewImage(null)}>
           <img src={previewImage} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
           <button className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full" onClick={() => setPreviewImage(null)}><svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
      )}
    </div>
  );
};

export default App;
