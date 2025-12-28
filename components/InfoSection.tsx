
import React from 'react';

interface InfoSectionProps {
  title: string;
  content: string;
  icon: React.ReactNode;
  bgColor: string;
  onEdit?: () => void;
}

const InfoSection: React.FC<InfoSectionProps> = ({ title, content, icon, bgColor, onEdit }) => {
  const processContent = (raw: string) => {
    // 1. Convert Markdown links: [Text](URL) -> <a href="URL">Text</a>
    let html = raw.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-[#bc6c25] font-bold underline hover:text-[#a65d4b] transition-colors">$1</a>');

    // 2. Convert Markdown tables to HTML tables
    const tableRegex = /\|(.+)\|[\r\n]+\|([\s:-|]+)\|[\r\n]+((?:\|.+|[\r\n]+)*)/g;
    html = html.replace(tableRegex, (match, headerRow, separatorRow, bodyRows) => {
      const headers = headerRow.split('|').map((h: string) => h.trim()).filter((h: string) => h !== '');
      const rows = bodyRows.trim().split('\n').map((row: string) => 
        row.split('|').map((c: string) => c.trim()).filter((c: string) => c !== '')
      ).filter((row: string[]) => row.length > 0);

      const headerHtml = `<thead><tr>${headers.map((h: string) => `<th>${h}</th>`).join('')}</tr></thead>`;
      const bodyHtml = `<tbody>${rows.map((row: string[]) => `<tr>${row.map((c: string) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;

      return `<div class="overflow-x-auto my-4 shadow-sm border border-slate-100 rounded-lg"><table>${headerHtml}${bodyHtml}</table></div>`;
    });

    // 3. Handle line breaks for non-table parts
    const parts = html.split(/(<div class="overflow-x-auto.*?<\/div>)/gs);
    const processedParts = parts.map(part => {
      if (part.startsWith('<div class="overflow-x-auto')) return part;
      return part.replace(/\n/g, '<br/>');
    });

    return processedParts.join('');
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6 relative group">
      <div className={`${bgColor} p-4 flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm text-white">
            {icon}
          </div>
          <h2 className="text-lg font-bold text-white uppercase tracking-wider">{title}</h2>
        </div>
        {onEdit && (
          <button 
            onClick={onEdit}
            className="bg-white/20 hover:bg-white/30 text-white text-xs px-3 py-1.5 rounded-lg font-bold transition-all border border-white/30 flex items-center gap-1.5"
          >
            ✏️ Edit Flights
          </button>
        )}
      </div>
      <div className="p-6 prose prose-slate max-w-none prose-headings:text-slate-800 prose-p:text-slate-600 prose-li:text-slate-600">
        <div 
          className="itinerary-section"
          dangerouslySetInnerHTML={{ __html: processContent(content) }} 
        />
      </div>
      <style>{`
        .itinerary-section table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
          background: white;
        }
        .itinerary-section th {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 0.75rem;
          text-align: left;
          font-weight: 700;
          color: #334155;
          white-space: nowrap;
        }
        .itinerary-section td {
          border: 1px solid #e2e8f0;
          padding: 0.75rem;
          color: #475569;
          vertical-align: middle;
        }
        .itinerary-section tr:nth-child(even) {
          background-color: #fdfbf7;
        }
        .itinerary-section tr:hover {
          background-color: #f1f5f9;
        }
      `}</style>
    </div>
  );
};

export default InfoSection;
