export type CatalogPlace = {
  name: string;
  kind: 'attraction' | 'stay';
  area: string;
  interests: string[];
  description: string;
  mapsUrl: string;
};

export type CatalogDestination = {
  name: string;
  aliases: string[];
  places: CatalogPlace[];
  sources: { label: string; url: string }[];
};

// Editorial selections researched against the official tourism references below
// on 2026-10-28. These are not live ratings, opening hours, prices or availability.
// Maps links are searches for the named location, not verified provider place IDs.
function attraction(
  destination: string,
  name: string,
  area: string,
  interests: string[],
  description: string,
): CatalogPlace {
  return {
    name, kind: 'attraction', area, interests, description,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${destination}`)}`,
  };
}

function stay(destination: string, area: string, interests: string[]): CatalogPlace {
  return {
    name: `${area} (stay area)`,
    kind: 'stay',
    area,
    interests,
    description: `Compare accommodation around ${area}; this is an area, not a hotel recommendation or a live quote.`,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${area}, ${destination}`)}`,
  };
}

export const CATALOG_DESTINATIONS: CatalogDestination[] = [
  {
    name: 'Jaipur',
    aliases: ['Jaipur', 'Jaipur India', 'Jaipur Rajasthan', 'Jaipur Rajasthan India'],
    places: [
      attraction('Jaipur India', 'Hawa Mahal', 'Old City', ['culture'], 'Historic palace with a distinctive windowed facade.'),
      attraction('Jaipur India', 'Jantar Mantar', 'Old City', ['culture'], 'Historic observatory with large astronomical instruments.'),
      attraction('Jaipur India', 'Amber Palace', 'Amer', ['culture', 'adventure'], 'Hilltop palace complex in Amer.'),
      attraction('Jaipur India', 'City Palace', 'Old City', ['culture'], 'Palace courtyards and museum collections.'),
      attraction('Jaipur India', 'Albert Hall Museum', 'Ram Niwas Garden', ['culture'], 'Museum within Ram Niwas Garden.'),
      attraction('Jaipur India', 'Nahargarh Fort', 'Nahargarh', ['culture', 'nature'], 'Aravalli hill fort overlooking Jaipur.'),
      attraction('Jaipur India', 'Jaigarh Fort', 'Amer', ['culture', 'adventure'], 'Historic fort above the Amer area.'),
      attraction('Jaipur India', 'Jal Mahal', 'Man Sagar Lake', ['nature', 'relaxation'], 'Lake palace viewed from the surrounding waterfront.'),
      stay('Jaipur India', 'Old City', ['culture', 'shopping']),
      stay('Jaipur India', 'Amer', ['culture', 'nature']),
      stay('Jaipur India', 'C Scheme', ['food', 'shopping']),
      stay('Jaipur India', 'Bani Park', ['relaxation']),
    ],
    sources: [
      { label: 'Rajasthan Tourism: Jaipur attractions and areas', url: 'https://www.tourism.rajasthan.gov.in/jaipur.html' },
      { label: 'Jaipur Municipal Corporation: heritage landmarks', url: 'https://www.jaipurmc.org/Presentation/AboutJaipur/OurHeritage.aspx' },
      { label: 'Rajasthan Tourism Development Corporation: Bani Park location', url: 'https://rtdc.tourism.rajasthan.gov.in/Client/HotelDetails.aspx?HotelID=JaipurAshokRSHCL' },
    ],
  },
  {
    name: 'Goa',
    aliases: ['Goa', 'Goa India'],
    places: [
      attraction('Goa India', 'Basilica of Bom Jesus', 'Old Goa', ['culture'], 'Historic church in Old Goa.'),
      attraction('Goa India', 'Aguada Fort', 'Sinquerim', ['culture', 'nature'], 'Coastal fort near Sinquerim Beach.'),
      attraction('Goa India', 'Chapora Fort', 'Chapora', ['culture', 'nature'], 'Fort overlooking the Vagator coastline.'),
      attraction('Goa India', 'Fontainhas', 'Panaji', ['culture', 'shopping'], 'Historic quarter for a neighbourhood walk.'),
      attraction('Goa India', 'Miramar Beach', 'Panaji', ['nature', 'relaxation'], 'Sandy shoreline near Panaji; plan a beach walk.'),
      attraction('Goa India', 'Anjuna Beach', 'Anjuna', ['nature', 'relaxation', 'shopping'], 'North Goa beach with a market district nearby.'),
      attraction('Goa India', 'Baga Beach', 'Baga', ['nature', 'relaxation', 'food'], 'North Goa shoreline and beachside food area.'),
      attraction('Goa India', 'Church of Our Lady of the Immaculate Conception', 'Panaji', ['culture'], 'Landmark church in central Panaji.'),
      stay('Goa India', 'Panaji', ['culture', 'food']),
      stay('Goa India', 'Calangute', ['nature', 'shopping']),
      stay('Goa India', 'Candolim', ['nature', 'relaxation']),
      stay('Goa India', 'Colva', ['nature', 'relaxation']),
    ],
    sources: [
      { label: 'Incredible India: Goa coastal and cultural attractions', url: 'https://www.incredibleindia.gov.in/en/trips/trip-listing/goas-coastal-and-cultural-delights' },
      { label: 'Government of Goa: coastal areas and beaches', url: 'https://www.goa.gov.in/what_to_see/beaches/' },
    ],
  },
  {
    name: 'Manali',
    aliases: ['Manali', 'Manali India', 'Manali Himachal Pradesh', 'Manali Himachal Pradesh India', 'Manali HP', 'Manali HP India'],
    places: [
      attraction('Manali India', 'Hidimba Devi Temple', 'Dhungri', ['culture', 'nature'], 'Traditional temple in the Dhungri area.'),
      attraction('Manali India', 'Manu Temple', 'Old Manali', ['culture'], 'Temple dedicated to Manu in Old Manali.'),
      attraction('Manali India', 'Vashisht Temple', 'Vashisht', ['culture'], 'Village temple near the hot springs.'),
      attraction('Manali India', 'Solang Valley', 'Solang', ['nature', 'adventure'], 'Mountain valley excursion; check weather and road access.'),
      attraction('Manali India', 'Nehru Kund', 'Burwa Road', ['nature', 'relaxation'], 'Natural spring on the route beyond Manali.'),
      attraction('Manali India', 'Manali Gompa', 'Manali town', ['culture'], 'Buddhist monastery near the Mall.'),
      attraction('Manali India', 'Naggar Castle', 'Naggar', ['culture', 'nature'], 'Historic castle; allow travel time to Naggar.'),
      attraction('Manali India', 'Gauri Shankar Temple Jagatsukh', 'Jagatsukh', ['culture'], 'Historic Shiva temple in nearby Jagatsukh village.'),
      stay('Manali India', 'Old Manali', ['food', 'culture']),
      stay('Manali India', 'Mall Road', ['food', 'shopping']),
      stay('Manali India', 'Vashisht', ['culture', 'relaxation']),
      stay('Manali India', 'Naggar', ['culture', 'nature']),
    ],
    sources: [
      { label: 'Himachal Tourism: Manali, nearby sights and villages', url: 'https://himachaltourism.gov.in/destination/manali/' },
    ],
  },
  {
    name: 'Delhi',
    aliases: ['Delhi', 'New Delhi', 'Delhi India', 'New Delhi India', 'Delhi NCT', 'Delhi NCT India', 'New Delhi Delhi India'],
    places: [
      attraction('Delhi India', 'India Gate', 'Central Delhi', ['culture', 'relaxation'], 'Memorial and surrounding outdoor public space.'),
      attraction('Delhi India', "Humayun's Tomb", 'Nizamuddin', ['culture', 'nature'], 'Historic garden tomb complex.'),
      attraction('Delhi India', 'Qutub Minar', 'Mehrauli', ['culture'], 'Historic minaret and archaeological complex.'),
      attraction('Delhi India', 'Red Fort', 'Old Delhi', ['culture'], 'Historic fortified palace complex.'),
      attraction('Delhi India', 'Lotus Temple', 'Bahapur', ['culture', 'relaxation'], 'Distinctive lotus-shaped house of worship.'),
      attraction('Delhi India', 'Lodhi Garden', 'Lodhi Road', ['nature', 'relaxation', 'culture'], 'Public garden with historic tombs.'),
      attraction('Delhi India', 'Agrasen Ki Baoli', 'Hailey Road', ['culture'], 'Historic stepwell in central Delhi.'),
      attraction('Delhi India', 'Purana Qila', 'Mathura Road', ['culture'], 'Historic fort with surviving gateways and monuments.'),
      stay('Delhi India', 'Connaught Place', ['food', 'shopping']),
      stay('Delhi India', 'Karol Bagh', ['shopping', 'food']),
      stay('Delhi India', 'Paharganj', ['food', 'shopping']),
      stay('Delhi India', 'Nizamuddin', ['culture']),
    ],
    sources: [
      { label: 'Delhi Tourism: monuments, gardens and neighbourhoods', url: 'https://www.delhitourism.gov.in/dt/explore-the-city.html' },
      { label: 'Delhi Tourism: accommodation locations', url: 'https://delhitourism.gov.in/accommodation/semi_lusury_hotels.html' },
    ],
  },
  {
    name: 'Mumbai',
    aliases: ['Mumbai', 'Bombay', 'Mumbai India', 'Bombay India', 'Mumbai Maharashtra', 'Mumbai Maharashtra India'],
    places: [
      attraction('Mumbai India', 'Gateway of India', 'Colaba', ['culture', 'relaxation'], 'Waterfront arch and public promenade.'),
      attraction('Mumbai India', 'Marine Drive', 'South Mumbai', ['nature', 'relaxation'], 'Curved seafront promenade for a walk.'),
      attraction('Mumbai India', 'Chhatrapati Shivaji Maharaj Terminus', 'Fort', ['culture'], 'Historic railway terminus; view its exterior architecture.'),
      attraction('Mumbai India', 'Elephanta Caves', 'Elephanta Island', ['culture', 'adventure'], 'Island cave temples; confirm ferry access and closures.'),
      attraction('Mumbai India', 'Haji Ali Dargah', 'Worli coast', ['culture'], 'Island shrine reached by a tidal causeway.'),
      attraction('Mumbai India', 'Juhu Beach', 'Juhu', ['nature', 'relaxation', 'food'], 'City beach for shoreline walks and food browsing.'),
      attraction('Mumbai India', 'Colaba Causeway', 'Colaba', ['shopping', 'food'], 'Market street in South Mumbai.'),
      attraction('Mumbai India', 'Siddhivinayak Temple', 'Prabhadevi', ['culture'], 'Well-known temple dedicated to Ganesha.'),
      stay('Mumbai India', 'Colaba', ['culture', 'shopping']),
      stay('Mumbai India', 'Marine Drive', ['nature', 'relaxation']),
      stay('Mumbai India', 'Juhu', ['nature', 'food']),
      stay('Mumbai India', 'Bandra', ['food', 'shopping']),
    ],
    sources: [
      { label: 'Maharashtra Tourism: Mumbai City', url: 'https://maharashtratourism.gov.in/districts/mumbai-city/' },
      { label: 'Maharashtra Tourism: Elephanta and Mumbai sights', url: 'https://maharashtratourism.gov.in/cave/elephanta/' },
      { label: 'Maharashtra Tourism: Mumbai suburbs and areas', url: 'https://maharashtratourism.gov.in/districts/mumbai-suburban/' },
    ],
  },
  {
    name: 'Bali',
    aliases: ['Bali', 'Bali Indonesia'],
    places: [
      attraction('Bali Indonesia', 'Tanah Lot Temple', 'Tabanan', ['culture', 'nature'], 'Coastal temple on a rocky outcrop.'),
      attraction('Bali Indonesia', 'Uluwatu Temple', 'Uluwatu', ['culture', 'nature'], 'Clifftop temple overlooking the ocean.'),
      attraction('Bali Indonesia', 'Tirta Empul Temple', 'Tampaksiring', ['culture'], 'Temple associated with sacred springs.'),
      attraction('Bali Indonesia', 'Ulun Danu Beratan Temple', 'Bedugul', ['culture', 'nature'], 'Temple beside Lake Beratan.'),
      attraction('Bali Indonesia', 'Sanur Beach', 'Sanur', ['nature', 'relaxation'], 'East-coast beach for a shoreline walk.'),
      attraction('Bali Indonesia', 'Kuta Beach', 'Kuta', ['nature', 'relaxation'], 'Well-known beach near Kuta town.'),
      attraction('Bali Indonesia', 'Jatiluwih Rice Terraces', 'Tabanan', ['nature', 'culture'], 'Terraced rice-field landscape; confirm permitted walking routes.'),
      attraction('Bali Indonesia', 'Bali Botanic Garden', 'Bedugul', ['nature', 'relaxation'], 'Botanical garden in the Bedugul highlands.'),
      stay('Bali Indonesia', 'Ubud', ['culture', 'nature']),
      stay('Bali Indonesia', 'Sanur', ['nature', 'relaxation']),
      stay('Bali Indonesia', 'Seminyak', ['food', 'shopping']),
      stay('Bali Indonesia', 'Kuta', ['nature', 'shopping']),
    ],
    sources: [
      { label: 'Indonesia Travel: Bali attractions', url: 'https://www.indonesia.travel/gb/en/destination/bali-nusa-tenggara/bali' },
      { label: 'Indonesia Travel: Bali accommodation areas', url: 'https://www.indonesia.travel/gb/en/travel-ideas/wellness/budget-villa-rentals-for-your-holiday-in-bali' },
      { label: 'Indonesia Travel: Bali visitor areas', url: 'https://www.indonesia.travel/sg/en/travel-ideas/culture/10-irresistible-things-about-bali' },
    ],
  },
];

function normalizeDestination(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function findCatalogDestination(input: string): CatalogDestination | undefined {
  if (typeof input !== 'string') return undefined;
  const normalized = normalizeDestination(input);
  if (!normalized) return undefined;
  // Exact aliases prevent a request such as "Delhi + Goa" being silently
  // interpreted as one city, or an unsupported city containing a familiar name.
  return CATALOG_DESTINATIONS.find((destination) =>
    destination.aliases.some((alias) => normalizeDestination(alias) === normalized)
  );
}
