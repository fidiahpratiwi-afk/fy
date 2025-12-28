
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { SearchParams, TravelData, GroundingSource } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

export const transcribeAudio = async (base64Audio: string): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        inlineData: {
          mimeType: 'audio/wav',
          data: base64Audio
        }
      },
      { text: "Transcribe this travel request accurately into a search query for a travel planner." }
    ]
  });
  return response.text || "";
};

export const analyzeMedia = async (base64Data: string, mimeType: string): Promise<string> => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      },
      { text: "Identify this location or document and suggest travel activities related to it." }
    ]
  });
  return response.text || "";
};

export const generateSpeech = async (text: string) => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Say this travel itinerary summary cheerfully: ${text.substring(0, 500)}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
};

export const generateTravelGuide = async (params: SearchParams, mediaData?: { data: string, mime: string }): Promise<TravelData> => {
  const ai = getAI();
  
  let model = 'gemini-3-flash-preview';
  let config: any = {};

  if (params.planMode === 'fast') {
    model = 'gemini-flash-lite-latest';
  } else if (params.planMode === 'deep') {
    model = 'gemini-3-pro-preview';
    config.thinkingConfig = { thinkingBudget: 32768 };
  } else {
    model = 'gemini-2.5-flash';
    config.tools = [{ googleSearch: {} }, { googleMaps: {} }];
  }

  const start = new Date(params.checkIn);
  const end = new Date(params.checkOut);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

  const prompt = `
    Act as a travel expert. Create a comprehensive travel guide for a trip from ${params.origin} to ${params.destination}.
    Dates: From ${params.checkIn} to ${params.checkOut} (${diffDays} days).
    Style: ${params.travelerType}, Travelers: ${params.person}, Budget: ${params.budget} ${params.currency}.
    
    CRITICAL SECTIONS TO INCLUDE: 
    1. "ITINERARY": Day-by-day plan with specific activities.
    2. "FLIGHTS & ACCOMMODATIONS": 
       - MUST include a "FLIGHT PRICE COMPARISON" section with a Markdown table.
       - The table must compare at least 3 major airlines relevant to the route.
       - Columns: Airline, Est. Price (${params.currency}), Duration, Transit, Booking Link.
       - IMPORTANT for "Transit" column: If the flight is direct, state 'Direct'. If there are layovers, specify the city and the duration of the layover (e.g., '1 stop in Dubai, 2h 30m').
       - The "Booking Link" column MUST contain a functional Markdown link to the airline's official booking page (e.g., [Book on AirlineName](https://www.airline.com)).
       - Include 2-3 specific accommodation recommendations with price ranges and direct booking links.
    3. "SAFETY AND CRIME": Relevant alerts.
    4. "HEALTH INFORMATION": Vaccinations or health tips.
    5. "ENVIRONMENTAL AND DISASTERS": Weather and local conditions.
    6. "TRAVEL TIPS": Useful hacks.

    Note: Use real-time data where possible for ${params.checkIn} travel period. Use grounding tools to find the most accurate URLs.
    ${mediaData ? "Incorporate information from the provided image/video analysis." : ""}
  `;

  const contents: any = mediaData 
    ? { parts: [{ inlineData: { data: mediaData.data, mimeType: mediaData.mime } }, { text: prompt }] }
    : prompt;

  const response = await ai.models.generateContent({
    model,
    contents,
    config,
  });

  const text = response.text || "";
  const sources: GroundingSource[] = [];
  const metadata = response.candidates?.[0]?.groundingMetadata;
  
  if (metadata?.groundingChunks) {
    metadata.groundingChunks.forEach((chunk: any) => {
      if (chunk.web) sources.push({ title: chunk.web.title, uri: chunk.web.uri });
      if (chunk.maps) sources.push({ title: chunk.maps.title, uri: chunk.maps.uri });
    });
  }

  const sections = text.split(/(?=ITINERARY|FLIGHTS & ACCOMMODATIONS|SAFETY AND CRIME|HEALTH INFORMATION|ENVIRONMENTAL AND DISASTERS|TRAVEL TIPS)/i);

  return {
    id: crypto.randomUUID(),
    itinerary: sections.find(s => s.toUpperCase().includes('ITINERARY')) || "Not found",
    accommodations: sections.find(s => s.toUpperCase().includes('FLIGHTS & ACCOMMODATIONS')) || "Not found",
    safety: sections.find(s => s.toUpperCase().includes('SAFETY AND CRIME')) || "Not found",
    health: sections.find(s => s.toUpperCase().includes('HEALTH INFORMATION')) || "Not found",
    environmental: sections.find(s => s.toUpperCase().includes('ENVIRONMENTAL AND DISASTERS')) || "Not found",
    tips: sections.find(s => s.toUpperCase().includes('TRAVEL TIPS')) || "Not found",
    sources,
    createdAt: Date.now()
  };
};
