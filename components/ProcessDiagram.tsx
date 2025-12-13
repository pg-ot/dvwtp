import React, { useState, useEffect } from 'react';
import { SimulationState, SimulationControls } from '../types';
import { AlertTriangle, XCircle } from 'lucide-react';

interface ProcessDiagramProps {
  state: SimulationState;
  controls: SimulationControls;
}

// --- Engineering Style Components ---

const DataTag: React.FC<{ x: number; y: number; value: string; unit?: string; alarm?: boolean }> = ({ x, y, value, unit, alarm }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Pill */}
    <rect x="-35" y="-9" width="70" height="18" rx="2" fill={alarm ? "#ef4444" : "#0f172a"} stroke={alarm ? "#b91c1c" : "#334155"} strokeWidth="1" />
    <text x="0" y="3" textAnchor="middle" className="text-[10px] font-bold fill-white font-mono tracking-tight">
      {value} <tspan className="text-[8px] font-normal opacity-70">{unit}</tspan>
    </text>
  </g>
);

const ISABubble: React.FC<{ x: number; y: number; type: string; tag: string }> = ({ x, y, type, tag }) => (
  <g transform={`translate(${x}, ${y})`}>
    <circle r="16" fill="white" stroke="#334155" strokeWidth="1.5" />
    <line x1="-16" y1="0" x2="16" y2="0" stroke="#334155" strokeWidth="1" />
    <text y="-4" textAnchor="middle" className="text-[9px] font-bold fill-slate-800">{type}</text>
    <text y="10" textAnchor="middle" className="text-[8px] font-mono font-medium fill-slate-600">{tag}</text>
  </g>
);

const InstrumentGroup: React.FC<{ 
  x: number; 
  y: number; 
  type: string; 
  tag: string; 
  value: string; 
  unit?: string; 
  alarm?: boolean;
  align?: 'top' | 'bottom' | 'left' | 'right';
}> = ({ x, y, type, tag, value, unit, alarm, align = 'bottom' }) => {
  // Offset for the DataTag relative to the bubble
  let tx = 0, ty = 0;
  if (align === 'bottom') ty = 30;
  if (align === 'top') ty = -30;
  if (align === 'right') tx = 55;
  if (align === 'left') tx = -55;

  return (
    <g transform={`translate(${x}, ${y})`}>
       {/* Leader Line if needed */}
       {align === 'top' && <line x1="0" y1="0" x2="0" y2="25" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />}
       {align === 'bottom' && <line x1="0" y1="0" x2="0" y2="-25" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />}
       
       <ISABubble x={0} y={0} type={type} tag={tag} />
       <DataTag x={tx} y={ty} value={value} unit={unit} alarm={alarm} />
    </g>
  );
};

const PumpSymbol: React.FC<{ x: number; y: number; active: boolean; label?: string; alignLabel?: 'top' | 'bottom' }> = ({ x, y, active, label, alignLabel = 'bottom' }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Pump Icon */}
    <g className="cursor-pointer hover:opacity-80 transition-opacity">
        <circle r="18" fill={active ? "#86efac" : "#e2e8f0"} stroke={active ? "#16a34a" : "#64748b"} strokeWidth="2" />
        <path d="M -8 8 L 12 -2 L -8 -12 Z" fill={active ? "#16a34a" : "#64748b"} />
    </g>
    {/* Label Badge */}
    {label && (
      <g transform={`translate(0, ${alignLabel === 'top' ? -40 : 28})`}>
        <rect x="-25" y="0" width="50" height="14" rx="2" fill="white" stroke="#cbd5e1" strokeWidth="1" />
        <text x="0" y="10" textAnchor="middle" className="text-[9px] fill-slate-600 font-bold uppercase">{label}</text>
      </g>
    )}
  </g>
);

const ValveSymbol: React.FC<{ x: number; y: number; open: boolean; label?: string; vertical?: boolean }> = ({ x, y, open, label, vertical }) => {
  const color = open ? "#86efac" : "#e2e8f0"; // Green if open, Light slate if closed
  const stroke = open ? "#16a34a" : "#64748b";
  
  return (
    <g transform={`translate(${x}, ${y})`}>
      <g transform={vertical ? "rotate(90)" : ""}>
        {/* Bowtie shape */}
        <path d="M -8 -5 L 8 5 L 8 -5 L -8 5 Z" fill={color} stroke={stroke} strokeWidth="1.5" />
        {/* Actuator stem */}
        <line x1="0" y1="0" x2="0" y2="-8" stroke="#475569" strokeWidth="1" />
        {/* Actuator Head */}
        <rect x="-5" y="-12" width="10" height="4" rx="1" fill="white" stroke="#475569" strokeWidth="1" />
      </g>
      {/* Label Badge */}
      {label && (
        <g transform={`translate(0, ${vertical ? 0 : 20})`}>
          {vertical ? (
             <text x={12} y={3} textAnchor="start" className="text-[8px] font-bold fill-slate-500">{label}</text>
          ) : (
             <text x={0} y={0} textAnchor="middle" className="text-[8px] font-bold fill-slate-500">{label}</text>
          )}
        </g>
      )}
    </g>
  );
};

const ChemicalSkid: React.FC<{ x: number; y: number; label: string; color: string; active: boolean; pumpLabel?: string }> = ({ x, y, label, color, active, pumpLabel }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Suction Line (Tank to Pump) - Rendered first to be behind pump */}
    <path d="M 20 0 L 45 0" stroke={color} strokeWidth="2" fill="none" />

    {/* Tank Stand */}
    <line x1="-15" y1="10" x2="-15" y2="25" stroke="#cbd5e1" strokeWidth="2" />
    <line x1="15" y1="10" x2="15" y2="25" stroke="#cbd5e1" strokeWidth="2" />

    {/* Tank Body */}
    <rect x="-20" y="-40" width="40" height="50" rx="2" fill="white" stroke="#64748b" strokeWidth="1" />
    {/* Liquid Level (Static visual) */}
    <rect x="-20" y="-10" width="40" height="20" rx="2" fill={color} opacity="0.4" />
    <text x="0" y="-20" textAnchor="middle" className="text-[10px] font-bold fill-slate-600">{label}</text>
    
    {/* Metering Pump - Moved to side (x=45, y=0) */}
    <g transform="translate(45, 0)">
      <circle r="8" fill={active ? "#86efac" : "#e2e8f0"} stroke={active ? "#16a34a" : "#64748b"} strokeWidth="1" />
      <path d="M -3 3 L 4 0 L -3 -3 Z" fill={active ? "#16a34a" : "#64748b"} />
      {pumpLabel && (
         <text x="0" y="-14" textAnchor="middle" className="text-[8px] font-bold fill-slate-400">{pumpLabel}</text>
      )}
    </g>
  </g>
);

const InjectionQuill: React.FC<{ x: number; y: number; color: string }> = ({ x, y, color }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Valve Body */}
    <path d="M -4 -6 L 4 -6 L 0 0 Z" fill={color} stroke="#475569" strokeWidth="1" />
    {/* Connection Point */}
    <circle cx="0" cy="0" r="1.5" fill="#475569" />
  </g>
);

const SumpSymbol: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <g transform={`translate(${x}, ${y})`}>
     {/* Funnel */}
     <path d="M -10 -10 L -5 0 L 5 0 L 10 -10" fill="none" stroke="#475569" strokeWidth="2" />
     {/* Liquid surface */}
     <path d="M -8 -4 L 8 -4" stroke="#0ea5e9" strokeWidth="1" strokeDasharray="2 1" />
     {/* Ground lines */}
     <line x1="-15" y1="0" x2="15" y2="0" stroke="#475569" strokeWidth="1" />
     <line x1="-12" y1="0" x2="-15" y2="3" stroke="#475569" strokeWidth="1" />
     <line x1="-8" y1="0" x2="-11" y2="3" stroke="#475569" strokeWidth="1" />
     <line x1="8" y1="0" x2="5" y2="3" stroke="#475569" strokeWidth="1" />
     <line x1="12" y1="0" x2="9" y2="3" stroke="#475569" strokeWidth="1" />
  </g>
);

const Tank2D: React.FC<{ x: number; y: number; w: number; h: number; levelPct: number; label: string; capacity: string }> = ({ x, y, w, h, levelPct, label, capacity }) => {
  const fillH = (levelPct / 100) * h;
  const isOverflowing = levelPct >= 100;
  const isLowLevel = levelPct < 15;
  // Color based on level
  const liquidColor = (isLowLevel || levelPct > 90) ? "#ef4444" : "#0284c7"; // Sky blue normally, Red alarm
  const darkLiquid = (isLowLevel || levelPct > 90) ? "#b91c1c" : "#0369a1";
  const clipId = `clip-${label.replace(/[^a-zA-Z0-9]/g, '')}-${x}-${y}`;
  
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Overflow Animation */}
      {isOverflowing && (
        <g>
          {/* Overflow spill from top */}
          <path d={`M ${w/4} -5 Q ${w/2} 0 ${w*3/4} -5 L ${w*3/4} 5 Q ${w/2} 10 ${w/4} 5 Z`} 
                fill="#ef4444" opacity="0.7" className="animate-pulse" />
          <text x={w/2} y="-15" textAnchor="middle" className="text-[10px] font-bold fill-red-600 animate-pulse">⚠ OVERFLOW</text>
          {/* Dripping effect */}
          <circle cx={w/3} cy="8" r="2" fill="#ef4444" className="animate-pulse" />
          <circle cx={w*2/3} cy="8" r="2" fill="#ef4444" className="animate-pulse" />
        </g>
      )}
      
      {/* Tank Outline */}
      <path 
        d={`M 0 10 Q ${w/2} -5 ${w} 10 L ${w} ${h-10} Q ${w/2} ${h+5} 0 ${h-10} Z`} 
        fill="#f1f5f9" 
        stroke={isOverflowing ? "#ef4444" : "#475569"} 
        strokeWidth={isOverflowing ? "3" : "2"}
        className={isOverflowing ? "animate-pulse" : ""}
      />
      
      {/* Liquid Clip */}
      <clipPath id={clipId}>
         <path d={`M 0 10 Q ${w/2} -5 ${w} 10 L ${w} ${h-10} Q ${w/2} ${h+5} 0 ${h-10} Z`} />
      </clipPath>
      
      {/* Liquid Level */}
      <g clipPath={`url(#${clipId})`}>
         <rect x="0" y={h - fillH} width={w} height={fillH} fill={liquidColor} className="transition-all duration-500" />
         {/* Top surface of liquid */}
         <ellipse cx={w/2} cy={h - fillH} rx={w/2} ry={5} fill={darkLiquid} opacity="0.3" className="transition-all duration-500" />
      </g>
      
      {/* Overlay Text */}
      <g transform={`translate(${w/2}, ${h/2})`}>
         <text y="-5" textAnchor="middle" className="text-sm font-bold fill-slate-800">{levelPct.toFixed(1)} %</text>
         <text y="10" textAnchor="middle" className="text-[10px] font-medium fill-slate-600">{capacity}</text>
      </g>
      
      {/* Label Tag below */}
      <g transform={`translate(${w/2}, ${h + 20})`}>
        <rect x="-30" y="-8" width="60" height="16" rx="8" fill="white" stroke="#cbd5e1" strokeWidth="1" />
        <text y="3" textAnchor="middle" className="text-[9px] font-bold fill-slate-600">{label}</text>
      </g>
    </g>
  );
};

const PipeLine: React.FC<{ d: string; active: boolean }> = ({ d, active }) => (
  <>
    <path d={d} stroke="#334155" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    {active && (
      <path d={d} stroke="#0ea5e9" strokeWidth="2" fill="none" strokeDasharray="4 6" className="animate-flow" />
    )}
  </>
);

const ROVessel: React.FC<{ x: number; y: number; width: number; height: number }> = ({ x, y, width, height }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Main Cylinder */}
    <rect x={-width/2} y={-height/2} width={width} height={height} fill="white" stroke="#475569" strokeWidth="1" />
    {/* End Caps */}
    <path d={`M ${-width/2} ${-height/2} Q ${-width/2 - 10} 0 ${-width/2} ${height/2} Z`} fill="#3b82f6" stroke="#1d4ed8" />
    <path d={`M ${width/2} ${-height/2} Q ${width/2 + 10} 0 ${width/2} ${height/2} Z`} fill="#3b82f6" stroke="#1d4ed8" />
    {/* Bands */}
    <rect x={-width/4} y={-height/2} width={5} height={height} fill="#cbd5e1" opacity="0.5" />
    <rect x={width/4} y={-height/2} width={5} height={height} fill="#cbd5e1" opacity="0.5" />
  </g>
);

const DamageOverlay: React.FC<{ x: number; y: number; health: number; label: string }> = ({ x, y, health, label }) => {
  if (health > 50) return null;
  
  const isCritical = health < 20;
  
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Crack/Damage Visual */}
      <g opacity={1 - (health / 100)}>
        <path d="M -8 -8 L 8 8 M -8 8 L 8 -8" stroke="#dc2626" strokeWidth="3" />
        <circle r="12" fill="none" stroke="#dc2626" strokeWidth="2" strokeDasharray="2 2" className="animate-pulse" />
      </g>
      {/* Warning Icon */}
      {isCritical && (
        <g transform="translate(15, -15)">
          <circle r="10" fill="#dc2626" className="animate-pulse" />
          <text x="0" y="4" textAnchor="middle" className="text-[10px] font-bold fill-white">!</text>
        </g>
      )}
    </g>
  );
};

const AlertBanner: React.FC<{ alerts: string[] }> = ({ alerts }) => {
  if (alerts.length === 0) return null;
  
  return (
    <div className="absolute top-12 left-1/2 transform -translate-x-1/2 z-50 max-w-2xl">
      {alerts.map((alert, idx) => (
        <div key={idx} className="bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg mb-2 flex items-center gap-2 animate-pulse">
          <AlertTriangle size={20} />
          <span className="font-bold text-sm">{alert}</span>
        </div>
      ))}
    </div>
  );
};

export const ProcessDiagram: React.FC<ProcessDiagramProps> = ({ state, controls }) => {
  const [alerts, setAlerts] = useState<string[]>([]);
  
  useEffect(() => {
    const newAlerts: string[] = [];
    
    if (state.membrane_health < 50) newAlerts.push(`⚠️ RO MEMBRANE FAILURE (${state.membrane_health.toFixed(0)}%)`);
    if (state.pump_well_health < 50) newAlerts.push(`⚠️ P-101 PUMP DAMAGE (${state.pump_well_health.toFixed(0)}%)`);
    if (state.pump_feed_health < 50) newAlerts.push(`⚠️ P-201 PUMP DAMAGE (${state.pump_feed_health.toFixed(0)}%)`);
    if (state.pump_dist_health < 50) newAlerts.push(`⚠️ P-401 PUMP DAMAGE (${state.pump_dist_health.toFixed(0)}%)`);
    if (state.pipe_well_health < 50) newAlerts.push(`⚠️ PIPE BURST AFTER P-101 (${state.pipe_well_health.toFixed(0)}%)`);
    if (state.pipe_feed_health < 50) newAlerts.push(`⚠️ PIPE BURST AFTER P-201 (${state.pipe_feed_health.toFixed(0)}%)`);
    if (state.pipe_dist_health < 50) newAlerts.push(`⚠️ PIPE BURST AFTER P-401 (${state.pipe_dist_health.toFixed(0)}%)`);
    
    setAlerts(newAlerts);
  }, [state]);
  
  const feedPct = (state.level_feed_tank / 5.0) * 100;
  const clearPct = (state.level_clearwell / 6.0) * 100;
  
  // Flows for visual feedback
  const f1 = state.Q_wellfield > 1;
  const f2 = state.Q_feed > 1;
  const f3 = state.Q_perm > 1;
  const f4 = state.Q_out > 1;

  // Simulate Dosing Flows (L/h) based on Permeate Flow (Flow Paced)
  const clFlow = (state.Q_perm > 1 && controls.cl_pump_on) ? (state.Q_perm * controls.Cl_dose * 0.012) : 0;
  const naohFlow = (state.Q_perm > 1 && controls.naoh_pump_on) ? (state.Q_perm * controls.NaOH_dose * 0.015) : 0;

  return (
    <div className="w-full h-full flex items-center justify-center select-none overflow-hidden relative">
      <AlertBanner alerts={alerts} />
      <svg viewBox="0 0 1720 600" preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        
        {/* --- PIPING & ROUTING --- */}
        
        {/* 1. Raw Water -> Feed Tank (Elevated inlet with drop) */}
        <PipeLine d="M 80 120 L 450 120 L 450 160" active={f1} />
        
        {/* 2. Feed Tank -> RO Feed Pump (Drop Down) */}
        <PipeLine d="M 450 290 L 450 450" active={f2} />

        {/* 3. RO Feed Pump -> RO Skid (Horizontal Bottom) */}
        {/* Center of Skid moved to 820 to declutter. Inlet enters at 820-110=710. Pipe goes to 710 */}
        <PipeLine d="M 450 450 L 710 450" active={f2} />

        {/* 4. RO Skid -> Permeate Riser (Up and Right) -> Clearwell Inlet Drop */}
        {/* Raised header from 250 to 220, dropping into tank at 1490 */}
        <PipeLine d="M 930 450 L 1000 450 L 1000 220 L 1490 220 L 1490 260" active={f3} />

        {/* 5. RO Brine -> Drain (Bottom Drop) */}
        {/* Brine drops from center of skid 820 */}
        <path d="M 820 470 L 820 520 L 900 520" stroke="#475569" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        {f3 && <path d="M 820 470 L 820 520 L 900 520" stroke="#f59e0b" strokeWidth="2" fill="none" strokeDasharray="4 6" className="animate-flow" />}

        {/* 6. Clearwell -> Dist Pump (Drop Down) */}
        {/* Tank Center 1490 (Tank at 1450). Pump P-401 at 1490 */}
        <PipeLine d="M 1490 390 L 1490 480" active={f4} />

        {/* 7. Dist Pump -> Out (Right) */}
        <PipeLine d="M 1490 480 L 1700 480" active={f4} />


        {/* --- COMPONENTS --- */}

        {/* Raw Water Source (Moved up to y=120) */}
        <g transform="translate(60, 120)">
          <rect x="-40" y="-20" width="80" height="40" rx="4" fill="white" stroke="#94a3b8" strokeWidth="2" />
          <text x="0" y="5" textAnchor="middle" className="text-xs font-bold fill-slate-700">Raw Water</text>
        </g>

        {/* Well Pump P-101 (Moved up to y=120) */}
        <PumpSymbol x={200} y={120} active={controls.wellfield_on} label="P-101" />
        <DamageOverlay x={200} y={120} health={state.pump_well_health} label="P-101" />
        <ValveSymbol x={230} y={120} open={controls.valve_101_open} label="XV-101" />
        <DamageOverlay x={270} y={120} health={state.pipe_well_health} label="Pipe" />
        
        {/* PIT-101 (Pressure after pump) */}
        <line x1="320" y1="120" x2="320" y2="70" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={320} y={70} type="PIT" tag="101" value={state.pressure_well.toFixed(1)} unit="bar" alarm={state.pressure_well > 10} align="top" />
        
        {/* FIT-101 (Flow meter) */}
        <line x1="380" y1="120" x2="380" y2="70" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={380} y={70} type="FIT" tag="101" value={state.Q_wellfield.toFixed(0)} unit="m³/h" align="top" />

        {/* Feed Tank TK-200 */}
        <Tank2D x={410} y={150} w={80} h={140} levelPct={feedPct} label="TK-200" capacity="500 m³" />
        <text x={450} y={110} textAnchor="middle" className="text-[10px] font-bold fill-slate-500 uppercase">RO FEED TANK</text>
        
        {/* LIT-200 (Left side) */}
        <line x1="410" y1="200" x2="380" y2="200" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={380} y={200} type="LIT" tag="200" value={((state.level_feed_tank / 5) * 100).toFixed(0)} unit="%" align="left" />


        {/* RO Feed Pump P-201 (Bottom Level) */}
        <PumpSymbol x={450} y={450} active={controls.ro_feed_pump_on} label="P-201" />
        <DamageOverlay x={450} y={450} health={state.pump_feed_health} label="P-201" />
        <ValveSymbol x={490} y={450} open={controls.valve_201_open} label="XV-201" />
        <DamageOverlay x={650} y={450} health={state.pipe_feed_health} label="Pipe" />
        
        {/* FIT-201, PIT-201, AIT-201 (Spread out to declutter) */}
        <line x1="530" y1="450" x2="530" y2="400" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={530} y={400} type="FIT" tag="201" value={state.Q_feed.toFixed(0)} unit="m³/h" align="top" />

        <line x1="600" y1="450" x2="600" y2="400" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={600} y={400} type="PIT" tag="201" value={state.pressure_feed.toFixed(1)} unit="bar" align="top" />

        <line x1="670" y1="450" x2="670" y2="400" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={670} y={400} type="AIT" tag="201" value={state.TDS_feed.toFixed(0)} unit="µS/cm" align="top" />

        {/* RO Skid (Centered at 820, Enlarged Width to 220) */}
        <g transform="translate(820, 450)">
           {/* Support Legs */}
           <line x1="-90" y1="-30" x2="-90" y2="30" stroke="#334155" strokeWidth="4" />
           <line x1="90" y1="-30" x2="90" y2="30" stroke="#334155" strokeWidth="4" />
           
           {/* Vessels */}
           <ROVessel x={0} y={-30} width={220} height={22} />
           <ROVessel x={0} y={0} width={220} height={22} />
           <ROVessel x={0} y={30} width={220} height={22} />
           
           {/* Membrane Damage Overlay */}
           <DamageOverlay x={0} y={0} health={state.membrane_health} label="Membrane" />
           
           <text x="0" y="-55" textAnchor="middle" className="text-xs font-bold fill-slate-700">RO SKID A</text>
           {/* PDT-201 */}
           <line x1="0" y1="-45" x2="0" y2="-85" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
           <InstrumentGroup x={0} y={-85} type="PDT" tag="201" value={state.dP_ro_true.toFixed(2)} unit="bar" alarm={state.dP_ro_true > 3.5} align="top" />
        </g>
        
        {/* NEW RO VALVES */}
        <ValveSymbol x={950} y={450} open={controls.valve_203_open} label="XV-203" />
        <ValveSymbol x={840} y={520} open={controls.valve_202_open} label="XV-202" />
        
        {/* FIT-203 (Permeate Flow) - Swapped with AIT-203 */}
        <line x1="980" y1="450" x2="980" y2="410" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={980} y={410} type="FIT" tag="203" value={state.Q_perm.toFixed(0)} unit="m³/h" align="top" />

        {/* Brine Line Instruments - Moved with skid center 820 */}
        <line x1="860" y1="520" x2="860" y2="550" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={860} y={550} type="FIT" tag="202" value={state.Q_brine.toFixed(0)} unit="m³/h" align="bottom" />
        
        <g transform="translate(930, 520)">
            <SumpSymbol x={-10} y={0} />
            <text x="20" y="3" textAnchor="start" className="text-[9px] font-bold fill-slate-500">SUMP</text>
        </g>


        {/* --- DOSING ZONE (Shifted Right to x=1050) --- */}
        
        <g transform="translate(1050, 50)">
          {/* Enclosure */}
          <rect width="340" height="120" rx="4" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
          <path d="M 0 25 L 340 25" stroke="#e2e8f0" strokeWidth="1" />
          <text x="170" y="16" textAnchor="middle" className="text-[10px] font-bold fill-slate-600 uppercase tracking-wide">Post-Treatment Dosing Skid</text>
          
          {/* Discharge Lines (Draw BEFORE pumps to be behind) */}
          {/* NaOCl Line */}
          <path d="M 105 70 L 115 70 L 115 170" stroke="#facc15" strokeWidth="2" fill="none" />
          {/* NaOH Line */}
          <path d="M 285 70 L 295 70 L 295 170" stroke="#a855f7" strokeWidth="2" fill="none" />

          {/* NaOCl Skid (Left) */}
          <g transform="translate(60, 70)">
            <ChemicalSkid x={0} y={0} label="NaOCl" color="#facc15" active={controls.cl_pump_on} pumpLabel="P-302" />
          </g>

          {/* NaOH Skid (Right) */}
          <g transform="translate(240, 70)">
            <ChemicalSkid x={0} y={0} label="NaOH" color="#a855f7" active={controls.naoh_pump_on} pumpLabel="P-301" />
          </g>

          {/* Instruments (Draw last to be on top) */}
          {/* FIT-302 */}
          <InstrumentGroup x={115} y={135} type="FIT" tag="302" value={clFlow.toFixed(1)} unit="L/h" align="right" />
          <InjectionQuill x={115} y={170} color="#facc15" />

          {/* FIT-301 */}
          <InstrumentGroup x={295} y={135} type="FIT" tag="301" value={naohFlow.toFixed(1)} unit="L/h" align="right" />
          <InjectionQuill x={295} y={170} color="#a855f7" />
        </g>

        {/* AIT-203 (Permeate Conductivity) - Swapped with FIT-203 */}
        <line x1="1000" y1="330" x2="1040" y2="330" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={1040} y={330} type="AIT" tag="203" value={state.TDS_perm.toFixed(0)} unit="µS/cm" align="right" />

        {/* Analyzers on Permeate Header - Raised to match pipe at 220 */}
        
        {/* AIT-302 (Cl2) - Between Injection points (x=1200) */}
        <line x1="1200" y1="220" x2="1200" y2="290" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={1200} y={290} type="AIT" tag="302" value={state.Cl_true.toFixed(2)} unit="mg/l" align="bottom" />

        {/* AIT-301 (pH) - After NaOH (x=1360) */}
        <line x1="1360" y1="220" x2="1360" y2="290" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={1360} y={290} type="AIT" tag="301" value={state.pH_true.toFixed(1)} unit="pH" alarm={state.pH_true > 8.5} align="bottom" />


        {/* Clearwell TK-300 (Moved to 1450) */}
        <Tank2D x={1450} y={250} w={80} h={140} levelPct={clearPct} label="TK-300" capacity="600 m³" />
        <text x={1490} y={210} textAnchor="middle" className="text-[10px] font-bold fill-slate-500 uppercase">CLEARWELL</text>
        
        {/* LIT-300 (Right Side x=1530) */}
        <line x1="1530" y1="300" x2="1560" y2="300" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={1560} y={300} type="LIT" tag="300" value={((state.level_clearwell/6)*100).toFixed(0)} unit="%" align="right" />


        {/* Distribution Pump P-401 (Aligned with tank center 1490) */}
        <PumpSymbol x={1490} y={480} active={controls.dist_pump_on} label="P-401" alignLabel='top' />
        <DamageOverlay x={1490} y={480} health={state.pump_dist_health} label="P-401" />
        <ValveSymbol x={1530} y={480} open={controls.valve_401_open} label="XV-401" />
        <DamageOverlay x={1600} y={480} health={state.pipe_dist_health} label="Pipe" />
        
        {/* PIT-401 (Pressure after pump) */}
        <line x1="1580" y1="480" x2="1580" y2="530" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={1580} y={530} type="PIT" tag="401" value={state.pressure_dist.toFixed(1)} unit="bar" alarm={state.pressure_dist > 12} align="bottom" />
        
        {/* FIT-401 */}
        <line x1="1630" y1="480" x2="1630" y2="530" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
        <InstrumentGroup x={1630} y={530} type="FIT" tag="401" value={state.Q_out.toFixed(0)} unit="m³/h" align="bottom" />

        {/* Destination */}
        <g transform="translate(1680, 480)">
          <rect x="-30" y="-15" width="60" height="30" rx="4" fill="white" stroke="#94a3b8" strokeWidth="2" />
          <text x="0" y="5" textAnchor="middle" className="text-xs font-bold fill-slate-700">Out</text>
        </g>

      </svg>
    </div>
  );
};