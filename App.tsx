
import React, { useState, useEffect, useRef } from 'react';
import { generateTravelGuide, transcribeAudio, generateSpeech, analyzeMedia } from './services/geminiService';
import { SearchParams, TravelData, ItineraryDay, ItineraryItem, FlightEntry } from './types';
import InfoSection from './components/InfoSection';

const App: React.FC = () => {
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [params, setParams] = useState<SearchParams>({
    origin: '', 
    destination: '', 
    checkIn: today,
    checkOut: nextWeek,
    currency: 'USD',
    budget: '1000', 
    travelerType: 'Backpacker', 
    person: 1, 
    planMode: 'detailed'
  });

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TravelData | null>(null);
  const [savedPlans, setSavedPlans] = useState<TravelData[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  
  // Save Naming Modal State
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [suggestedName, setSuggestedName] = useState("");

  // Flight Editor State
  const [editingFlights, setEditingFlights] = useState<FlightEntry[] | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  useEffect(() => {
    // Migration check or simply use the new key for the brand
    const saved = localStorage.getItem('myvication_plans_v1') || localStorage.getItem('wanderguard_plans_v2');
    if (saved) setSavedPlans(JSON.parse(saved));
  }, []);

  const saveToStorage = (plans: TravelData[]) => {
    setSavedPlans(plans);
    localStorage.setItem('myvication_plans_v1', JSON.stringify(plans));
  };

  const calculateNights = () => {
    const start = new Date(params.checkIn);
    const end = new Date(params.checkOut);
    const diffTime = end.getTime() - start.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  const parseItinerary = (text: string): ItineraryDay[] => {
    const lines = text.split('\n');
    const days: ItineraryDay[] = [];
    let currentDay: ItineraryDay | null = null;

    lines.forEach((line, idx) => {
      const dayMatch = line.match(/Day\s*\d+/i);
      if (dayMatch) {
        if (currentDay) days.push(currentDay);
        currentDay = { id: `day-${idx}`, title: line.trim(), content: '', checklist: [] };
      } else if (currentDay) {
        if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
          currentDay.checklist.push({
            id: `item-${crypto.randomUUID()}`,
            text: line.replace(/^[-*]\s*/, '').trim(),
            completed: false
          });
        } else {
          currentDay.content += line + '\n';
        }
      }
    });
    if (currentDay) days.push(currentDay);
    return days;
  };

  const parseFlightsFromMarkdown = (markdown: string): FlightEntry[] => {
    const tableRegex = /\|(.+)\|[\r\n]+\|([\s:-|]+)\|[\r\n]+((?:\|.+|[\r\n]+)*)/g;
    const match = tableRegex.exec(markdown);
    if (!match) return [];

    const bodyRows = match[3].trim().split('\n');
    return bodyRows.map(row => {
      const cols = row.split('|').map(c => c.trim()).filter(c => c !== '');
      const airline = cols[0] || '';
      const price = cols[1] || '';
      const duration = cols[2] || '';
      const transit = cols[3] || '';
      const linkMatch = (cols[4] || '').match(/\[.+\]\((.+)\)/);
      const link = linkMatch ? linkMatch[1] : (cols[4] || '');
      
      return { airline, price, duration, transit, link };
    });
  };

  const serializeFlightsToMarkdown = (flights: FlightEntry[]): string => {
    if (flights.length === 0) return "";
    const header = `| Airline | Est. Price (${params.currency}) | Duration | Transit | Booking Link |\n`;
    const separator = `|:---|:---|:---|:---|:---|\n`;
    const rows = flights.map(f => {
      const airlineText = f.airline.includes('[') ? f.airline : `[${f.airline}](${f.link})`;
      const linkText = `[Book Now](${f.link})`;
      return `| ${airlineText} | ${f.price} | ${f.duration} | ${f.transit} | ${linkText} |`;
    }).join('\n');
    
    return `${header}${separator}${rows}`;
  };

  const handleOpenFlightEditor = () => {
    if (!data) return;
    const parsed = parseFlightsFromMarkdown(data.accommodations);
    setEditingFlights(parsed.length > 0 ? parsed : [{ airline: '', price: '', duration: '', transit: '', link: '' }]);
  };

  const handleSaveFlights = () => {
    if (!data || !editingFlights) return;
    
    const tableRegex = /\|(.+)\|[\r\n]+\|([\s:-|]+)\|[\r\n]+((?:\|.+|[\r\n]+)*)/g;
    const newTableMd = serializeFlightsToMarkdown(editingFlights);
    
    let newAccommodations = data.accommodations;
    if (tableRegex.test(data.accommodations)) {
      newAccommodations = data.accommodations.replace(tableRegex, newTableMd);
    } else {
      newAccommodations = `### FLIGHT PRICE COMPARISON\n\n${newTableMd}\n\n${data.accommodations}`;
    }

    setData({ ...data, accommodations: newAccommodations });
    setEditingFlights(null);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!params.destination) return;
    setLoading(true);
    try {
      const result = await generateTravelGuide(params);
      const parsed = { ...result, parsedItinerary: parseItinerary(result.itinerary) };
      setData(parsed);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];
      mediaRecorder.current.ondataavailable = (e) => audioChunks.current.push(e.data);
      mediaRecorder.current.onstop = async () => {
        const blob = new Blob(audioChunks.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const query = await transcribeAudio(base64);
          setParams(prev => ({ ...prev, destination: query }));
        };
      };
      mediaRecorder.current.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setIsRecording(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = async () => {
      const base64 = (reader.result as string).split(',')[1];
      const result = await generateTravelGuide(params, { data: base64, mime: file.type });
      setData({ ...result, parsedItinerary: parseItinerary(result.itinerary) });
      setLoading(false);
    };
  };

  const playTTS = async () => {
    if (!data) return;
    const base64 = await generateSpeech(data.itinerary);
    if (base64) {
      alert("Voice summary ready! (Standard Audio API will playback if hardware supports raw PCM stream)");
    }
  };

  const handleSaveClick = () => {
    if (!data) return;
    const formatDate = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    const defaultName = `${params.destination} Expedition (${formatDate(params.checkIn)} - ${formatDate(params.checkOut)})`;
    setSuggestedName(defaultName);
    setIsSaveModalOpen(true);
  };

  const confirmSavePlan = () => {
    if (!data) return;
    const planToSave = { 
      ...data, 
      customName: suggestedName, 
      createdAt: Date.now() 
    };
    const newPlans = [planToSave, ...savedPlans];
    saveToStorage(newPlans);
    setIsSaveModalOpen(false);
    alert("Expedition saved successfully!");
  };

  const deletePlan = (id: string) => {
    if (confirm("Are you sure you want to delete this expedition?")) {
      const filtered = savedPlans.filter(p => p.id !== id);
      saveToStorage(filtered);
    }
  };

  const clearAllPlans = () => {
    if (confirm("Are you sure you want to delete ALL saved expeditions? This cannot be undone.")) {
      saveToStorage([]);
    }
  };

  const updateItem = (dayId: string, itemId: string, updates: Partial<ItineraryItem>) => {
    if (!data || !data.parsedItinerary) return;
    const updated = data.parsedItinerary.map(day => {
      if (day.id === dayId) {
        return {
          ...day,
          checklist: day.checklist.map(item => item.id === itemId ? { ...item, ...updates } : item)
        };
      }
      return day;
    });
    setData({ ...data, parsedItinerary: updated });
  };

  const deleteItem = (dayId: string, itemId: string) => {
    if (!data || !data.parsedItinerary) return;
    const updated = data.parsedItinerary.map(day => {
      if (day.id === dayId) {
        return {
          ...day,
          checklist: day.checklist.filter(item => item.id !== itemId)
        };
      }
      return day;
    });
    setData({ ...data, parsedItinerary: updated });
  };

  const addNewItem = (dayId: string) => {
    if (!data || !data.parsedItinerary) return;
    const updated = data.parsedItinerary.map(day => {
      if (day.id === dayId) {
        return {
          ...day,
          checklist: [...day.checklist, { id: `item-${crypto.randomUUID()}`, text: '', completed: false }]
        };
      }
      return day;
    });
    setData({ ...data, parsedItinerary: updated });
  };

  const startRename = (id: string, currentName?: string) => {
    setEditingPlanId(id);
    setRenameValue(currentName || "Unnamed Plan");
  };

  const submitRename = () => {
    const updated = savedPlans.map(p => p.id === editingPlanId ? { ...p, customName: renameValue } : p);
    saveToStorage(updated);
    setEditingPlanId(null);
  };

  return (
    <div className="min-h-screen bg-[#fdfbf7] text-[#283618] pb-40">
      <header className="bg-[#606c38] text-white p-4 sticky top-0 z-50 shadow-lg">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold flex items-center gap-2">🌍 MyVication</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowSaved(!showSaved)} className="bg-white/10 px-4 py-2 rounded-lg hover:bg-white/20 text-sm transition-colors">
              Saved ({savedPlans.length})
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 mt-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-[#e9edc9] mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#606c38] uppercase">Departure</label>
              <input 
                className="p-3 border rounded-xl outline-none focus:ring-2 ring-[#bc6c25]" 
                placeholder="Origin (e.g. Jakarta)" 
                value={params.origin} 
                onChange={e => setParams({...params, origin: e.target.value})}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#606c38] uppercase">Destination</label>
              <div className="relative flex items-center">
                <input 
                  className="p-3 border rounded-xl outline-none focus:ring-2 ring-[#bc6c25] w-full" 
                  placeholder="Destination (e.g. Tokyo)" 
                  value={params.destination} 
                  onChange={e => setParams({...params, destination: e.target.value})}
                />
                <button 
                  onMouseDown={startRecording} 
                  onMouseUp={stopRecording}
                  title="Voice Search"
                  className={`absolute right-2 p-2 rounded-full ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-100'}`}
                >
                  🎤
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 mb-6">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#606c38] uppercase">AI Intelligence</label>
              <select className="p-2 border rounded-lg text-sm" value={params.planMode} onChange={e => setParams({...params, planMode: e.target.value as any})}>
                <option value="fast">Fast (Lite)</option>
                <option value="detailed">Detailed (Search & Maps)</option>
                <option value="deep">Deep (Pro Thinking)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[#606c38] uppercase">Media Attachment</label>
              <input type="file" onChange={handleFileUpload} className="text-xs" accept="image/*,video/*" />
            </div>
          </div>

          <button 
            onClick={() => handleSearch()} 
            disabled={loading}
            className="w-full bg-[#bc6c25] text-white font-bold py-3 rounded-xl hover:bg-[#a65d4b] transition-all disabled:opacity-50 shadow-md"
          >
            {loading ? "Analyzing Routes & Prices..." : "Generate Itinerary"}
          </button>
        </div>

        {data && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-[#fefae0] p-6 rounded-3xl border border-[#e9edc9] gap-4">
              <div>
                <h2 className="text-2xl font-black text-[#283618]">{data.customName || params.destination}</h2>
                <div className="flex items-center gap-2 mt-1">
                   <span className="text-xs bg-[#bc6c25]/10 text-[#bc6c25] px-2 py-0.5 rounded-full font-bold">
                    {params.checkIn} — {params.checkOut}
                   </span>
                   <span className="text-xs text-slate-500 italic">({calculateNights()} nights)</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={playTTS} title="Read Summary" className="bg-white p-3 rounded-full shadow hover:scale-105 transition">🔊</button>
                <button onClick={handleSaveClick} className="bg-[#606c38] text-white px-6 py-2 rounded-xl hover:opacity-90 font-bold transition shadow-sm">Save Adventure</button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-[#606c38] px-2">
                <h3 className="font-bold text-sm uppercase tracking-wider">Plan Checklist</h3>
                <span className="text-[10px] text-slate-400">Items are editable</span>
              </div>
              {data.parsedItinerary?.map(day => (
                <div key={day.id} className="bg-white p-6 rounded-2xl border border-[#e9edc9] shadow-sm">
                  <div className="flex justify-between items-center mb-4 border-b border-[#fefae0] pb-2">
                    <h3 className="text-lg font-bold text-[#606c38]">{day.title}</h3>
                    <button 
                      onClick={() => addNewItem(day.id)}
                      className="text-[10px] bg-[#bc6c25]/10 text-[#bc6c25] px-2 py-1 rounded-lg font-bold hover:bg-[#bc6c25]/20 transition"
                    >
                      + Add Item
                    </button>
                  </div>
                  <div className="space-y-2">
                    {day.checklist.length > 0 ? (
                      day.checklist.map(item => (
                        <div key={item.id} className="flex items-center gap-3 p-2 hover:bg-[#fdfbf7] rounded-lg transition group">
                          <button 
                            onClick={() => updateItem(day.id, item.id, { completed: !item.completed })}
                            className={`w-5 h-5 border-2 rounded flex items-center justify-center transition shrink-0 ${item.completed ? 'bg-[#bc6c25] border-[#bc6c25]' : 'border-[#e9edc9] bg-white'}`}
                          >
                            {item.completed && <span className="text-white text-[10px]">✓</span>}
                          </button>
                          
                          <input 
                            className={`text-sm bg-transparent border-none outline-none w-full focus:ring-1 ring-[#bc6c25]/30 rounded px-1 ${item.completed ? 'line-through text-slate-400' : 'text-[#283618]'}`}
                            value={item.text}
                            placeholder="Describe activity..."
                            onChange={(e) => updateItem(day.id, item.id, { text: e.target.value })}
                          />

                          <button 
                            onClick={() => deleteItem(day.id, item.id)}
                            className="text-red-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100 p-1 shrink-0"
                            title="Delete Item"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500 leading-relaxed italic" dangerouslySetInnerHTML={{ __html: day.content.replace(/\n/g, '<br/>') }} />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoSection 
                title="Stay & Logistics" 
                content={data.accommodations} 
                icon="🏨" 
                bgColor="bg-[#dda15e]" 
                onEdit={handleOpenFlightEditor}
              />
              <InfoSection title="Safety & Tips" content={data.safety} icon="🛡️" bgColor="bg-[#a65d4b]" />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoSection title="Health" content={data.health} icon="🩺" bgColor="bg-[#8d7d6b]" />
              <InfoSection title="Environmental" content={data.environmental} icon="🌍" bgColor="bg-[#606c38]" />
            </div>
          </div>
        )}
      </main>

      {/* Flight Editor Modal */}
      {editingFlights && (
        <div className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-white w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 bg-[#bc6c25] text-white flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">Edit Flight Comparison</h3>
                <p className="text-xs opacity-80">Manually update airline details, prices, and transit info</p>
              </div>
              <button onClick={() => setEditingFlights(null)} className="text-2xl hover:opacity-70 transition">✕</button>
            </div>
            <div className="p-6 max-h-[70vh] overflow-y-auto">
              <div className="space-y-4">
                {editingFlights.map((flight, idx) => (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-5 gap-3 p-4 border border-slate-100 rounded-2xl bg-slate-50/50 relative group">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Airline</label>
                      <input 
                        className="p-2 border rounded-lg text-sm bg-white" 
                        value={flight.airline} 
                        onChange={e => {
                          const newF = [...editingFlights];
                          newF[idx].airline = e.target.value;
                          setEditingFlights(newF);
                        }} 
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Price ({params.currency})</label>
                      <input 
                        className="p-2 border rounded-lg text-sm bg-white" 
                        value={flight.price} 
                        onChange={e => {
                          const newF = [...editingFlights];
                          newF[idx].price = e.target.value;
                          setEditingFlights(newF);
                        }} 
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Duration</label>
                      <input 
                        className="p-2 border rounded-lg text-sm bg-white" 
                        value={flight.duration} 
                        onChange={e => {
                          const newF = [...editingFlights];
                          newF[idx].duration = e.target.value;
                          setEditingFlights(newF);
                        }} 
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Transit (Direct or Stops)</label>
                      <input 
                        className="p-2 border rounded-lg text-sm bg-white" 
                        value={flight.transit} 
                        placeholder="Direct or city+duration"
                        onChange={e => {
                          const newF = [...editingFlights];
                          newF[idx].transit = e.target.value;
                          setEditingFlights(newF);
                        }} 
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Booking URL</label>
                      <div className="flex gap-2">
                        <input 
                          className="p-2 border rounded-lg text-sm bg-white w-full" 
                          value={flight.link} 
                          placeholder="https://..."
                          onChange={e => {
                            const newF = [...editingFlights];
                            newF[idx].link = e.target.value;
                            setEditingFlights(newF);
                          }} 
                        />
                        <button 
                          onClick={() => {
                            const newF = editingFlights.filter((_, i) => i !== idx);
                            setEditingFlights(newF.length ? newF : [{ airline: '', price: '', duration: '', transit: '', link: '' }]);
                          }}
                          className="text-red-400 hover:text-red-600 p-1"
                        >✕</button>
                      </div>
                    </div>
                  </div>
                ))}
                <button 
                  onClick={() => setEditingFlights([...editingFlights, { airline: '', price: '', duration: '', transit: '', link: '' }])}
                  className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 font-bold hover:bg-slate-50 transition"
                >
                  + Add Another Airline Option
                </button>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t flex justify-end gap-3">
               <button onClick={() => setEditingFlights(null)} className="px-6 py-2 rounded-xl text-slate-500 font-bold">Cancel</button>
               <button onClick={handleSaveFlights} className="bg-[#bc6c25] text-white px-8 py-2 rounded-xl font-bold shadow-md hover:opacity-90 transition">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Save Naming Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 bg-[#606c38] text-white">
              <h3 className="text-xl font-bold flex items-center gap-2">💾 Save Your Journey</h3>
              <p className="text-xs opacity-80 mt-1">Give your expedition a memorable name</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#606c38] uppercase">Expedition Name</label>
                <input 
                  className="p-4 border border-[#e9edc9] rounded-xl outline-none focus:ring-2 ring-[#bc6c25] w-full text-lg font-medium" 
                  value={suggestedName} 
                  onChange={e => setSuggestedName(e.target.value)}
                  autoFocus
                />
              </div>
              <p className="text-xs text-slate-400 italic">This will be added to your saved plans for easy access later.</p>
            </div>
            <div className="p-6 bg-slate-50 border-t flex gap-3">
               <button onClick={() => setIsSaveModalOpen(false)} className="flex-1 py-3 rounded-xl text-slate-500 font-bold hover:bg-slate-100 transition">Cancel</button>
               <button onClick={confirmSavePlan} className="flex-1 bg-[#bc6c25] text-white py-3 rounded-xl font-bold shadow-md hover:opacity-90 transition">Confirm Save</button>
            </div>
          </div>
        </div>
      )}

      {showSaved && (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-5 bg-[#606c38] text-white flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">📂 Saved Expeditions</h3>
                <p className="text-[10px] opacity-70 uppercase tracking-widest font-bold">Your Travel History</p>
              </div>
              <div className="flex items-center gap-3">
                {savedPlans.length > 0 && (
                  <button 
                    onClick={clearAllPlans} 
                    className="text-xs bg-red-500/20 hover:bg-red-500/40 px-3 py-1.5 rounded-lg border border-red-500/30 font-bold transition-all"
                  >
                    Clear All
                  </button>
                )}
                <button onClick={() => setShowSaved(false)} className="opacity-70 hover:opacity-100 text-xl">✕</button>
              </div>
            </div>
            <div className="p-4 max-h-[70vh] overflow-y-auto space-y-3">
              {savedPlans.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="text-4xl mb-4">📭</div>
                  <p className="text-slate-400 italic text-sm">No itineraries saved yet. Start by generating a plan!</p>
                </div>
              ) : (
                savedPlans.map(plan => (
                  <div key={plan.id} className="p-4 border border-[#e9edc9] rounded-2xl hover:bg-[#fefae0] transition-all flex justify-between items-center group shadow-sm bg-white">
                    <div className="flex-1 overflow-hidden pr-4">
                      {editingPlanId === plan.id ? (
                        <div className="flex gap-2">
                          <input className="border p-1 rounded-lg flex-1 outline-none ring-1 ring-[#bc6c25] text-sm" value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus />
                          <button onClick={submitRename} className="bg-[#606c38] text-white px-3 rounded-lg text-xs font-bold">Done</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-bold truncate text-[#283618]">{plan.customName || "Unnamed Trip"}</span>
                          <button onClick={() => startRename(plan.id, plan.customName)} className="text-[10px] text-[#bc6c25] font-bold opacity-0 group-hover:opacity-100 transition-opacity">Rename</button>
                        </div>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-medium">
                        🗓️ {new Date(plan.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => { setData(plan); setShowSaved(false); }} 
                        className="text-[#606c38] font-bold text-xs px-3 py-2 bg-[#606c38]/10 rounded-xl hover:bg-[#606c38]/20 transition-colors"
                      >
                        Load
                      </button>
                      <button 
                        onClick={() => deletePlan(plan.id)} 
                        className="bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-all p-2 rounded-xl border border-red-100"
                        title="Delete Expedition"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-4 bg-slate-50 border-t text-center">
               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Plans are stored locally in your browser</p>
            </div>
          </div>
        </div>
      )}

      {/* Drawer - Interactive Config */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-[#e9edc9] p-4 z-40 shadow-2xl">
        <div className="max-w-6xl mx-auto flex flex-wrap justify-center gap-6 items-end">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black text-[#606c38] uppercase tracking-tighter">Check-In</span>
            <input 
              type="date" 
              className="text-xs p-2 rounded-lg bg-[#fdfbf7] border border-[#e9edc9] outline-none focus:ring-1 ring-[#bc6c25]" 
              value={params.checkIn} 
              onChange={e => setParams({...params, checkIn: e.target.value})} 
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black text-[#606c38] uppercase tracking-tighter">Check-Out</span>
            <input 
              type="date" 
              className="text-xs p-2 rounded-lg bg-[#fdfbf7] border border-[#e9edc9] outline-none focus:ring-1 ring-[#bc6c25]" 
              value={params.checkOut} 
              onChange={e => setParams({...params, checkOut: e.target.value})} 
            />
          </div>
          <div className="flex flex-col items-center justify-center p-2 bg-[#bc6c25]/5 rounded-lg border border-[#bc6c25]/10 min-w-[60px]">
             <span className="text-[10px] font-bold text-[#bc6c25] uppercase">Stay</span>
             <span className="text-sm font-black text-[#bc6c25]">{calculateNights()} <span className="text-[8px]">nights</span></span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black text-[#606c38] uppercase tracking-tighter">Budget</span>
            <div className="flex gap-1">
               <input className="text-xs p-2 rounded-lg bg-[#fdfbf7] border border-[#e9edc9] w-14 outline-none" value={params.currency} onChange={e => setParams({...params, currency: e.target.value})} placeholder="USD" />
               <input className="text-xs p-2 rounded-lg bg-[#fdfbf7] border border-[#e9edc9] w-20 outline-none" value={params.budget} onChange={e => setParams({...params, budget: e.target.value})} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black text-[#606c38] uppercase tracking-tighter">Group</span>
            <div className="flex items-center gap-2">
              <input type="number" min="1" className="text-xs p-2 rounded-lg bg-[#fdfbf7] border border-[#e9edc9] w-12 outline-none" value={params.person} onChange={e => setParams({...params, person: parseInt(e.target.value) || 1})} />
              <span className="text-[10px] text-slate-400">👤</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black text-[#606c38] uppercase tracking-tighter">Expedition Style</span>
            <select className="text-xs p-2 rounded-lg bg-[#fdfbf7] border border-[#e9edc9] outline-none appearance-none pr-8 cursor-pointer" value={params.travelerType} onChange={e => setParams({...params, travelerType: e.target.value})}>
              <option value="Backpacker">Backpacker</option>
              <option value="Luxury">Luxury</option>
              <option value="Nature">Nature</option>
              <option value="History">History</option>
              <option value="Business">Business</option>
              <option value="Family">Family</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
