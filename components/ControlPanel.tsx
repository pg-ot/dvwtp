import React from 'react';
import { SimulationControls } from '../types';
import { Power, RotateCcw, AlertOctagon } from 'lucide-react';

interface ControlPanelProps {
  controls: SimulationControls;
  onToggle: (key: keyof SimulationControls) => void;
  onUpdate: (key: keyof SimulationControls, value: number) => void;
  onEmergencyStop: () => void;
  onReset: () => void;
  onResetDamage: () => void;
}

// --- styled components ---

const Card: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
  <div className={`bg-white rounded border border-slate-200 shadow-sm ${className}`}>
    <div className="px-2 py-1 border-b border-slate-100 bg-slate-50/80">
      <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{title}</h3>
    </div>
    <div className="p-1.5 grid gap-1">
      {children}
    </div>
  </div>
);

const IndustrialSwitch: React.FC<{ 
  label: string; 
  id: string;
  active: boolean; 
  onClick: () => void 
}> = ({ label, id, active, onClick }) => (
  <div className="flex items-center justify-between py-0.5 px-1">
    <div className="flex flex-col">
      <span className="text-[10px] font-bold text-slate-700 leading-tight">{label}</span>
      <span className="text-[8px] text-slate-400 font-mono">{id}</span>
    </div>
    
    {/* Rocker Switch Visual */}
    <button 
      onClick={onClick}
      className={`relative w-10 h-5 rounded flex items-center transition-all duration-200 cursor-pointer shadow-inner border
        ${active ? 'bg-green-600 border-green-700' : 'bg-slate-200 border-slate-300'}
      `}
    >
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded shadow-sm transition-all duration-200 flex items-center justify-center
        ${active ? 'left-[22px]' : 'left-0.5'}
      `}>
        <div className={`w-0.5 h-2 rounded-full ${active ? 'bg-green-500' : 'bg-slate-300'}`} />
      </div>
      <span className={`absolute text-[7px] font-bold text-white/90 left-1 ${active ? 'opacity-100' : 'opacity-0'}`}>ON</span>
      <span className={`absolute text-[7px] font-bold text-slate-400 right-1 ${!active ? 'opacity-100' : 'opacity-0'}`}>OFF</span>
    </button>
  </div>
);

const RangeControl: React.FC<{
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
}> = ({ label, unit, value, min, max, step, onChange }) => (
  <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
    <div className="flex justify-between items-end mb-0.5">
      <label className="text-[9px] font-bold text-slate-600 uppercase">{label}</label>
      <div className="flex items-baseline gap-0.5">
        <span className="font-mono text-[10px] font-bold text-blue-600">{value.toFixed(1)}</span>
        <span className="text-[8px] text-slate-400">{unit}</span>
      </div>
    </div>
    <input 
      type="range" 
      min={min} max={max} step={step} 
      value={value} 
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 hover:accent-blue-500"
    />
  </div>
);

export const ControlPanel: React.FC<ControlPanelProps> = ({ 
  controls, 
  onToggle, 
  onUpdate,
  onEmergencyStop,
  onReset,
  onResetDamage
}) => {
  return (
    <div className="h-full grid grid-cols-2 gap-2">
      {/* Column 1: Equipment */}
      <div className="flex flex-col gap-2">
        <Card title="Pre-Treatment">
            <IndustrialSwitch id="P-101" label="Well Pump" active={controls.wellfield_on} onClick={() => onToggle('wellfield_on')} />
            <IndustrialSwitch id="XV-101" label="Well Discharge" active={controls.valve_101_open} onClick={() => onToggle('valve_101_open')} />
        </Card>
        
        <Card title="RO Train A">
            <IndustrialSwitch id="P-201" label="Feed Pump" active={controls.ro_feed_pump_on} onClick={() => onToggle('ro_feed_pump_on')} />
            <IndustrialSwitch id="XV-201" label="Feed Discharge" active={controls.valve_201_open} onClick={() => onToggle('valve_201_open')} />
            <IndustrialSwitch id="XV-203" label="Permeate Valve" active={controls.valve_203_open} onClick={() => onToggle('valve_203_open')} />
            <IndustrialSwitch id="XV-202" label="Reject Valve" active={controls.valve_202_open} onClick={() => onToggle('valve_202_open')} />
        </Card>
        
        <Card title="Distribution">
            <IndustrialSwitch id="P-401" label="Dist. Pump" active={controls.dist_pump_on} onClick={() => onToggle('dist_pump_on')} />
            <IndustrialSwitch id="XV-401" label="Dist. Discharge" active={controls.valve_401_open} onClick={() => onToggle('valve_401_open')} />
        </Card>
      </div>

      {/* Column 2: Setpoints & Safety */}
      <div className="flex flex-col gap-2">
        <Card title="Dosing">
            <IndustrialSwitch id="P-301" label="NaOH Pump" active={controls.naoh_pump_on} onClick={() => onToggle('naoh_pump_on')} />
            <RangeControl label="NaOH" unit="mg/L" value={controls.NaOH_dose} min={0} max={20} step={0.5} onChange={(v) => onUpdate('NaOH_dose', v)} />
            <IndustrialSwitch id="P-302" label="Cl₂ Pump" active={controls.cl_pump_on} onClick={() => onToggle('cl_pump_on')} />
            <RangeControl label="Cl₂" unit="mg/L" value={controls.Cl_dose} min={0} max={5} step={0.1} onChange={(v) => onUpdate('Cl_dose', v)} />
        </Card>
        
        <Card title="Setpoints">
            <RangeControl label="Flow SP" unit="m³/h" value={controls.Q_out_sp} min={0} max={150} step={5} onChange={(v) => onUpdate('Q_out_sp', v)} />
        </Card>
        
        <div className="mt-auto grid gap-1.5">
             <button 
                onClick={onReset}
                className="w-full py-1.5 bg-green-600 text-white border border-green-700 hover:bg-green-700 rounded shadow-sm font-bold text-[9px] uppercase transition-colors flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={11} /> Normal Operation
              </button>
              
             <button 
                onClick={onResetDamage}
                className="w-full py-1.5 bg-blue-600 text-white border border-blue-700 hover:bg-blue-700 rounded shadow-sm font-bold text-[9px] uppercase transition-colors flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={11} /> Reset Damage
              </button>

            <div className="border border-red-200 bg-red-50 p-1.5 rounded relative overflow-hidden">
               <div className="absolute top-0 right-0 p-1 opacity-10">
                  <AlertOctagon size={48} className="text-red-500" />
               </div>
               <button 
                onClick={onEmergencyStop}
                className="w-full py-2 bg-red-600 hover:bg-red-700 text-white border-b-4 border-red-800 rounded shadow-sm font-bold text-[10px] uppercase transition-all active:border-b-0 active:translate-y-[4px] flex items-center justify-center gap-1.5 z-10 relative"
              >
                <Power size={12} /> E-Stop
              </button>
            </div>
        </div>
      </div>
    </div>
  );
};