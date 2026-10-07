"""The tracked instrument universe: large and mid-cap NSE names, a handful of
ETFs, and the headline indices. Anything outside this list still works — it is
resolved through the data provider on demand."""
from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Instrument:
    symbol: str
    name: str
    sector: str
    industry: str
    asset_class: str = "Equity"

    def as_dict(self) -> dict:
        return asdict(self)


_E = "Equity"
_RAW: list[tuple[str, str, str, str]] = [
    # Financials
    ("HDFCBANK", "HDFC Bank", "Financials", "Private Bank"),
    ("ICICIBANK", "ICICI Bank", "Financials", "Private Bank"),
    ("SBIN", "State Bank of India", "Financials", "PSU Bank"),
    ("KOTAKBANK", "Kotak Mahindra Bank", "Financials", "Private Bank"),
    ("AXISBANK", "Axis Bank", "Financials", "Private Bank"),
    ("INDUSINDBK", "IndusInd Bank", "Financials", "Private Bank"),
    ("BANKBARODA", "Bank of Baroda", "Financials", "PSU Bank"),
    ("PNB", "Punjab National Bank", "Financials", "PSU Bank"),
    ("CANBK", "Canara Bank", "Financials", "PSU Bank"),
    ("BAJFINANCE", "Bajaj Finance", "Financials", "NBFC"),
    ("BAJAJFINSV", "Bajaj Finserv", "Financials", "Financial Services"),
    ("SHRIRAMFIN", "Shriram Finance", "Financials", "NBFC"),
    ("CHOLAFIN", "Cholamandalam Investment", "Financials", "NBFC"),
    ("MUTHOOTFIN", "Muthoot Finance", "Financials", "NBFC"),
    ("JIOFIN", "Jio Financial Services", "Financials", "Financial Services"),
    ("PFC", "Power Finance Corporation", "Financials", "Infrastructure Finance"),
    ("RECLTD", "REC", "Financials", "Infrastructure Finance"),
    ("HDFCLIFE", "HDFC Life Insurance", "Financials", "Insurance"),
    ("SBILIFE", "SBI Life Insurance", "Financials", "Insurance"),
    ("ICICIGI", "ICICI Lombard General Insurance", "Financials", "Insurance"),
    ("LICI", "Life Insurance Corporation", "Financials", "Insurance"),
    ("HDFCAMC", "HDFC Asset Management", "Financials", "Asset Management"),
    ("BSE", "BSE", "Financials", "Exchange"),
    # Information technology
    ("TCS", "Tata Consultancy Services", "IT", "IT Services"),
    ("INFY", "Infosys", "IT", "IT Services"),
    ("HCLTECH", "HCL Technologies", "IT", "IT Services"),
    ("WIPRO", "Wipro", "IT", "IT Services"),
    ("TECHM", "Tech Mahindra", "IT", "IT Services"),
    ("PERSISTENT", "Persistent Systems", "IT", "IT Services"),
    ("COFORGE", "Coforge", "IT", "IT Services"),
    ("MPHASIS", "Mphasis", "IT", "IT Services"),
    # Energy
    ("RELIANCE", "Reliance Industries", "Energy", "Oil & Gas"),
    ("ONGC", "Oil & Natural Gas Corporation", "Energy", "Oil & Gas"),
    ("IOC", "Indian Oil Corporation", "Energy", "Refining"),
    ("BPCL", "Bharat Petroleum", "Energy", "Refining"),
    ("HINDPETRO", "Hindustan Petroleum", "Energy", "Refining"),
    ("GAIL", "GAIL (India)", "Energy", "Gas Distribution"),
    ("COALINDIA", "Coal India", "Energy", "Coal"),
    # Power & utilities
    ("NTPC", "NTPC", "Power & Utilities", "Power Generation"),
    ("POWERGRID", "Power Grid Corporation", "Power & Utilities", "Transmission"),
    ("TATAPOWER", "Tata Power", "Power & Utilities", "Integrated Power"),
    ("ADANIPOWER", "Adani Power", "Power & Utilities", "Power Generation"),
    ("ADANIGREEN", "Adani Green Energy", "Power & Utilities", "Renewables"),
    ("JSWENERGY", "JSW Energy", "Power & Utilities", "Power Generation"),
    ("NHPC", "NHPC", "Power & Utilities", "Hydro Power"),
    # FMCG
    ("ITC", "ITC", "FMCG", "Diversified FMCG"),
    ("HINDUNILVR", "Hindustan Unilever", "FMCG", "Personal Care"),
    ("NESTLEIND", "Nestle India", "FMCG", "Packaged Foods"),
    ("BRITANNIA", "Britannia Industries", "FMCG", "Packaged Foods"),
    ("TATACONSUM", "Tata Consumer Products", "FMCG", "Beverages"),
    ("DABUR", "Dabur India", "FMCG", "Personal Care"),
    ("GODREJCP", "Godrej Consumer Products", "FMCG", "Personal Care"),
    ("MARICO", "Marico", "FMCG", "Personal Care"),
    ("VBL", "Varun Beverages", "FMCG", "Beverages"),
    ("COLPAL", "Colgate-Palmolive (India)", "FMCG", "Personal Care"),
    # Automobiles
    ("MARUTI", "Maruti Suzuki India", "Automobiles", "Passenger Vehicles"),
    ("M&M", "Mahindra & Mahindra", "Automobiles", "Passenger Vehicles"),
    ("TMPV", "Tata Motors Passenger Vehicles", "Automobiles", "Passenger Vehicles"),
    ("BAJAJ-AUTO", "Bajaj Auto", "Automobiles", "Two Wheelers"),
    ("HEROMOTOCO", "Hero MotoCorp", "Automobiles", "Two Wheelers"),
    ("EICHERMOT", "Eicher Motors", "Automobiles", "Two Wheelers"),
    ("TVSMOTOR", "TVS Motor Company", "Automobiles", "Two Wheelers"),
    ("ASHOKLEY", "Ashok Leyland", "Automobiles", "Commercial Vehicles"),
    ("MOTHERSON", "Samvardhana Motherson", "Automobiles", "Auto Components"),
    ("BOSCHLTD", "Bosch", "Automobiles", "Auto Components"),
    # Pharma & healthcare
    ("SUNPHARMA", "Sun Pharmaceutical", "Healthcare", "Pharmaceuticals"),
    ("DRREDDY", "Dr. Reddy's Laboratories", "Healthcare", "Pharmaceuticals"),
    ("CIPLA", "Cipla", "Healthcare", "Pharmaceuticals"),
    ("DIVISLAB", "Divi's Laboratories", "Healthcare", "Pharmaceuticals"),
    ("LUPIN", "Lupin", "Healthcare", "Pharmaceuticals"),
    ("TORNTPHARM", "Torrent Pharmaceuticals", "Healthcare", "Pharmaceuticals"),
    ("ZYDUSLIFE", "Zydus Lifesciences", "Healthcare", "Pharmaceuticals"),
    ("APOLLOHOSP", "Apollo Hospitals", "Healthcare", "Hospitals"),
    ("MAXHEALTH", "Max Healthcare", "Healthcare", "Hospitals"),
    # Metals & mining
    ("TATASTEEL", "Tata Steel", "Metals & Mining", "Steel"),
    ("JSWSTEEL", "JSW Steel", "Metals & Mining", "Steel"),
    ("JINDALSTEL", "Jindal Steel", "Metals & Mining", "Steel"),
    ("HINDALCO", "Hindalco Industries", "Metals & Mining", "Aluminium"),
    ("VEDL", "Vedanta", "Metals & Mining", "Diversified Metals"),
    ("NMDC", "NMDC", "Metals & Mining", "Iron Ore"),
    # Industrials
    ("LT", "Larsen & Toubro", "Industrials", "Engineering & Construction"),
    ("SIEMENS", "Siemens", "Industrials", "Electrical Equipment"),
    ("ABB", "ABB India", "Industrials", "Electrical Equipment"),
    ("CGPOWER", "CG Power & Industrial", "Industrials", "Electrical Equipment"),
    ("BHEL", "Bharat Heavy Electricals", "Industrials", "Electrical Equipment"),
    ("CUMMINSIND", "Cummins India", "Industrials", "Engines"),
    ("POLYCAB", "Polycab India", "Industrials", "Cables & Wires"),
    ("HAVELLS", "Havells India", "Industrials", "Consumer Electricals"),
    # Defence
    ("HAL", "Hindustan Aeronautics", "Defence", "Aerospace"),
    ("BEL", "Bharat Electronics", "Defence", "Defence Electronics"),
    ("MAZDOCK", "Mazagon Dock Shipbuilders", "Defence", "Shipbuilding"),
    ("BDL", "Bharat Dynamics", "Defence", "Missiles & Munitions"),
    # Telecom
    ("BHARTIARTL", "Bharti Airtel", "Telecom", "Telecom Services"),
    ("IDEA", "Vodafone Idea", "Telecom", "Telecom Services"),
    ("INDUSTOWER", "Indus Towers", "Telecom", "Tower Infrastructure"),
    # Consumer discretionary
    ("TITAN", "Titan Company", "Consumer", "Jewellery & Watches"),
    ("TRENT", "Trent", "Consumer", "Retail"),
    ("DMART", "Avenue Supermarts", "Consumer", "Retail"),
    ("ETERNAL", "Eternal (Zomato)", "Consumer", "Internet & Delivery"),
    ("NYKAA", "FSN E-Commerce (Nykaa)", "Consumer", "Internet & Retail"),
    ("ASIANPAINT", "Asian Paints", "Consumer", "Paints"),
    ("PIDILITIND", "Pidilite Industries", "Consumer", "Adhesives"),
    ("DIXON", "Dixon Technologies", "Consumer", "Electronics Manufacturing"),
    ("INDHOTEL", "Indian Hotels Company", "Consumer", "Hotels"),
    ("JUBLFOOD", "Jubilant FoodWorks", "Consumer", "Quick Service Restaurants"),
    ("PAGEIND", "Page Industries", "Consumer", "Apparel"),
    # Cement & materials
    ("ULTRACEMCO", "UltraTech Cement", "Cement & Materials", "Cement"),
    ("GRASIM", "Grasim Industries", "Cement & Materials", "Diversified"),
    ("SHREECEM", "Shree Cement", "Cement & Materials", "Cement"),
    ("AMBUJACEM", "Ambuja Cements", "Cement & Materials", "Cement"),
    ("SRF", "SRF", "Cement & Materials", "Specialty Chemicals"),
    ("PIIND", "PI Industries", "Cement & Materials", "Agrochemicals"),
    ("UPL", "UPL", "Cement & Materials", "Agrochemicals"),
    # Infrastructure & logistics
    ("ADANIPORTS", "Adani Ports & SEZ", "Infrastructure", "Ports"),
    ("ADANIENT", "Adani Enterprises", "Infrastructure", "Diversified"),
    ("INDIGO", "InterGlobe Aviation", "Infrastructure", "Airlines"),
    ("IRCTC", "IRCTC", "Infrastructure", "Railways"),
    ("IRFC", "Indian Railway Finance Corp", "Infrastructure", "Railways"),
    ("RVNL", "Rail Vikas Nigam", "Infrastructure", "Railways"),
    # Realty
    ("DLF", "DLF", "Realty", "Real Estate"),
    ("LODHA", "Lodha Developers", "Realty", "Real Estate"),
    ("GODREJPROP", "Godrej Properties", "Realty", "Real Estate"),
    ("OBEROIRLTY", "Oberoi Realty", "Realty", "Real Estate"),
]

_FUNDS: list[Instrument] = [
    Instrument("NIFTYBEES", "Nippon India ETF Nifty 50 BeES", "Index Funds", "Nifty 50 ETF", "Funds & ETFs"),
    Instrument("JUNIORBEES", "Nippon India ETF Nifty Next 50", "Index Funds", "Nifty Next 50 ETF", "Funds & ETFs"),
    Instrument("BANKBEES", "Nippon India ETF Nifty Bank BeES", "Index Funds", "Bank Nifty ETF", "Funds & ETFs"),
    Instrument("MON100", "Motilal Oswal Nasdaq 100 ETF", "Index Funds", "International ETF", "Funds & ETFs"),
    Instrument("GOLDBEES", "Nippon India ETF Gold BeES", "Commodities", "Gold ETF", "Gold"),
    Instrument("SILVERBEES", "Nippon India Silver ETF", "Commodities", "Silver ETF", "Gold"),
    Instrument("LIQUIDBEES", "Nippon India ETF Liquid BeES", "Cash Equivalents", "Liquid ETF", "Cash"),
]

INSTRUMENTS: dict[str, Instrument] = {s: Instrument(s, n, sec, ind, _E) for s, n, sec, ind in _RAW}
INSTRUMENTS.update({i.symbol: i for i in _FUNDS})

EQUITY_UNIVERSE: list[str] = [s for s, i in INSTRUMENTS.items() if i.asset_class == "Equity"]

# symbol -> (display name, short name).
# Only indices Yahoo carries daily history for. The other NIFTY sector indices
# (Auto, FMCG, Metal, Energy, Realty, PSU Bank, Infrastructure) return a single
# bar, so sector moves are computed from the tracked stocks instead.
INDICES: dict[str, tuple[str, str]] = {
    "^NSEI": ("NIFTY 50", "NIFTY"),
    "^BSESN": ("S&P BSE SENSEX", "SENSEX"),
    "^NSEBANK": ("NIFTY Bank", "BANKNIFTY"),
    "^NSMIDCP": ("NIFTY Next 50", "NEXT 50"),
    "^CRSLDX": ("NIFTY 500", "NIFTY 500"),
    "^CNXIT": ("NIFTY IT", "IT"),
    "^CNXPHARMA": ("NIFTY Pharma", "PHARMA"),
    "^INDIAVIX": ("India VIX", "VIX"),
}
HEADLINE_INDICES = ["^NSEI", "^BSESN", "^NSEBANK", "^NSMIDCP", "^CNXIT", "^INDIAVIX"]
SECTOR_INDICES = ["^CNXIT", "^NSEBANK", "^CNXPHARMA"]

BENCHMARKS = {"^NSEI": "NIFTY 50", "^BSESN": "SENSEX", "^CRSLDX": "NIFTY 500", "^NSMIDCP": "NIFTY Next 50"}

# Yahoo sector labels -> the taxonomy used above.
YAHOO_SECTORS = {
    "Financial Services": "Financials",
    "Technology": "IT",
    "Energy": "Energy",
    "Consumer Defensive": "FMCG",
    "Consumer Cyclical": "Consumer",
    "Healthcare": "Healthcare",
    "Basic Materials": "Metals & Mining",
    "Industrials": "Industrials",
    "Utilities": "Power & Utilities",
    "Communication Services": "Telecom",
    "Real Estate": "Realty",
}


def normalize(symbol: str) -> str:
    """Canonical app symbol: upper-case, NSE suffix dropped."""
    s = symbol.strip().upper()
    return s[:-3] if s.endswith(".NS") else s


def yahoo_symbol(symbol: str) -> str:
    s = normalize(symbol)
    return s if s.startswith("^") or "." in s or "=" in s else f"{s}.NS"


def is_index(symbol: str) -> bool:
    return symbol.startswith("^")
