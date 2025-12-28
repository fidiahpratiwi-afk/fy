
export interface GroundingSource {
  title?: string;
  uri?: string;
}

export interface ItineraryItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface ItineraryDay {
  id: string;
  title: string;
  content: string;
  checklist: ItineraryItem[];
}

export interface FlightEntry {
  airline: string;
  price: string;
  duration: string;
  transit: string;
  link: string;
}

export interface TravelData {
  id: string;
  customName?: string;
  itinerary: string;
  accommodations: string;
  safety: string;
  health: string;
  environmental: string;
  tips: string;
  sources: GroundingSource[];
  createdAt: number;
  parsedItinerary?: ItineraryDay[];
}

export interface SearchParams {
  origin: string;
  destination: string;
  checkIn: string;
  checkOut: string;
  currency: string;
  budget: string;
  travelerType: string;
  person: number;
  planMode: 'fast' | 'detailed' | 'deep';
}
