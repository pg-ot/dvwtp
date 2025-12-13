import React from 'react';
import { SimulationState } from '../types';

interface DataPanelProps {
  state: SimulationState;
}

// Status Badge Component
const StatusBadge: React.FC<{ status: 'normal' | 'warning' | 'alarm' | 'critical' }> = ({ status }) => {
  if (status === 'critical') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700 border border-purple-200 animate-pulse">
        FAIL
      </span>
    );
  }
  if (status === 'alarm') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-700 border border-red-200 animate-pulse">
        ALARM
      </span>
    );
  }
  if (status === 'warning') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
        WARN
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">
      OK
    </span>
  );
};

const DataRow: React.FC<{ 
  label: string; 
  value: string; 
  unit: string; 
  status?: 'normal' | 'warning' | 'alarm' | 'critical';
  isStriped?: boolean;
}> = ({ label, value, unit, status = 'normal', isStriped }) => {
  return (
    <div className={`flex items-center justify-between px-3 py-2 ${isStriped ? 'bg-slate-50' : 'bg-white'} border-b border-slate-50 hover:bg-blue-50/50 transition-colors group`}>
      <span className="text-[11px] text-slate-500 font-medium group-hover:text-slate-700">{label}</span>
      <div className="flex items-center gap-3">
        <StatusBadge status={status} />
        <div className="text-right w-20">
          <span className={`text-xs font-mono font-bold ${status === 'alarm' || status === 'critical' ? 'text-red-600' : 'text-slate-700'}`}>
            {value}
          </span>
          <span className="text-[9px] text-slate-400 ml-1">{unit}</span>
        </div>
      </div>
    </div>
  );
};

const TableSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border border-slate-200 rounded-lg overflow-hidden flex flex-col h-full shadow-sm">
    <div className="bg-slate-100 px-3 py-2 border-b border-slate-200">
       <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</span>
    </div>
    <div className="flex-1 bg-white">
      {children}
    </div>
  </div>
);

export const DataPanel: React.FC<DataPanelProps> = ({ state }) => {
  const recovery = state.Q_feed > 0 ? ((state.Q_perm / state.Q_feed) * 100) : 0;

  // Derive Health Status
  const memHealthStatus = state.membrane_health < 50 ? 'critical' : state.membrane_health < 80 ? 'warning' : 'normal';
  const pumpHealthStatus = state.pump_feed_health < 80 ? 'critical' : 'normal';

  return (
    <div className="h-full grid grid-cols-1 md:grid-cols-4 gap-4 font-sans">
        
        {/* Table 1: Pre-Treatment */}
        <TableSection title="Pre-Treatment">
             <DataRow label="Wellfield Flow" value={state.Q_wellfield.toFixed(1)} unit="m³/h" isStriped />
             <DataRow label="Feed Tank Level" value={((state.level_feed_tank/5)*100).toFixed(0)} unit="%" status={(state.level_feed_tank < 0.5 || state.level_feed_tank > 4.8) ? 'alarm' : 'normal'} />
             <DataRow label="Feed Conductivity" value={state.TDS_feed.toFixed(0)} unit="µS/cm" isStriped />
             <DataRow label="Feed Pressure" value={state.pressure_feed.toFixed(1)} unit="bar" status={state.pressure_feed > 15 ? 'alarm' : 'normal'} />
             <DataRow label="Feed Pump Health" value={state.pump_feed_health.toFixed(1)} unit="%" status={pumpHealthStatus} isStriped />
        </TableSection>

        {/* Table 2: RO Process */}
        <TableSection title="RO Skid Performance">
             <DataRow label="Feed Flow" value={state.Q_feed.toFixed(1)} unit="m³/h" isStriped />
             <DataRow label="Permeate Flow" value={state.Q_perm.toFixed(1)} unit="m³/h" />
             <DataRow label="Permeate Cond." value={state.TDS_perm.toFixed(0)} unit="µS/cm" status={state.TDS_perm > 100 ? 'alarm' : 'normal'} isStriped />
             <DataRow label="Reject Flow" value={state.Q_brine.toFixed(1)} unit="m³/h" />
             <DataRow label="Recovery Rate" value={recovery.toFixed(1)} unit="%" status={recovery < 70 && state.Q_feed > 10 ? 'warning' : 'normal'} isStriped />
             <DataRow label="Diff. Pressure" value={state.dP_ro_true.toFixed(2)} unit="bar" status={state.dP_ro_true > 1.5 ? 'warning' : 'normal'} />
             <DataRow label="Membrane Health" value={state.membrane_health.toFixed(1)} unit="%" status={memHealthStatus} isStriped />
        </TableSection>

        {/* Table 3: Post-Treatment */}
        <TableSection title="Post-Treatment">
             <DataRow label="Clearwell Level" value={((state.level_clearwell/6)*100).toFixed(0)} unit="%" status={state.level_clearwell < 0.5 || state.level_clearwell > 5.8 ? 'alarm' : 'normal'} isStriped />
             <DataRow label="Product pH" value={state.pH_true.toFixed(2)} unit="pH" status={(state.pH_true > 8.5 || state.pH_true < 6.5) ? 'alarm' : 'normal'} />
             <DataRow label="Residual Chlorine" value={state.Cl_true.toFixed(2)} unit="mg/L" status={state.Cl_true > 2.0 ? 'alarm' : 'normal'} isStriped />
             <DataRow label="Distribution Flow" value={state.Q_out.toFixed(1)} unit="m³/h" />
        </TableSection>
        
        {/* Table 4: Equipment Health */}
        <TableSection title="Equipment Health">
             <DataRow label="RO Membrane" value={state.membrane_health.toFixed(1)} unit="%" status={state.membrane_health < 50 ? 'critical' : state.membrane_health < 80 ? 'warning' : 'normal'} isStriped />
             <DataRow label="P-101 Pump" value={state.pump_well_health.toFixed(1)} unit="%" status={state.pump_well_health < 50 ? 'critical' : state.pump_well_health < 80 ? 'warning' : 'normal'} />
             <DataRow label="P-201 Pump" value={state.pump_feed_health.toFixed(1)} unit="%" status={state.pump_feed_health < 50 ? 'critical' : state.pump_feed_health < 80 ? 'warning' : 'normal'} isStriped />
             <DataRow label="P-401 Pump" value={state.pump_dist_health.toFixed(1)} unit="%" status={state.pump_dist_health < 50 ? 'critical' : state.pump_dist_health < 80 ? 'warning' : 'normal'} />
             <DataRow label="Pipe (P-101)" value={state.pipe_well_health.toFixed(1)} unit="%" status={state.pipe_well_health < 50 ? 'critical' : state.pipe_well_health < 80 ? 'warning' : 'normal'} isStriped />
             <DataRow label="Pipe (P-201)" value={state.pipe_feed_health.toFixed(1)} unit="%" status={state.pipe_feed_health < 50 ? 'critical' : state.pipe_feed_health < 80 ? 'warning' : 'normal'} />
             <DataRow label="Pipe (P-401)" value={state.pipe_dist_health.toFixed(1)} unit="%" status={state.pipe_dist_health < 50 ? 'critical' : state.pipe_dist_health < 80 ? 'warning' : 'normal'} isStriped />
        </TableSection>

    </div>
  );
};