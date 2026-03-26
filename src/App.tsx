import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, Wrench, BarChart3, Table as TableIcon, Settings,
  Plus, Search, Bell, UserCircle, Shield, Clock,
  CheckCircle2, XCircle, Edit, Trash2, Activity
} from 'lucide-react';
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale,
  LinearScale, BarElement, Title, PointElement, LineElement
} from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import { format, subWeeks, startOfWeek, endOfWeek, isWithinInterval, parseISO, startOfMonth, endOfMonth, isSameMonth } from 'date-fns';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title, PointElement, LineElement);

type TaskType = 'CAE해석' | '강도시험' | '내구시험' | '설계검토' | '기타';
type ResultType = '합격' | '불합격' | '진행중';

interface RndRecord {
  id: string;
  date: string;
  partCode: string;
  engineer: string;
  taskType: TaskType;
  result: ResultType;
  safetyFactor?: number;
  notes?: string;
  createdAt: any;
  updatedAt: any;
}

export default function App() {
  const [records, setRecords] = useState<RndRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RndRecord | null>(null);

  // Filters
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterTaskType, setFilterTaskType] = useState<TaskType | '전체'>('전체');
  const [filterResult, setFilterResult] = useState<ResultType | '전체'>('전체');
  const [filterEngineer, setFilterEngineer] = useState('');

  // Form State
  const [formData, setFormData] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    partCode: '',
    engineer: '',
    taskType: 'CAE해석' as TaskType,
    result: '진행중' as ResultType,
    safetyFactor: '',
    notes: ''
  });

  useEffect(() => {
    const q = query(collection(db, 'rnd_records'), orderBy('date', 'desc'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as RndRecord[];
      setRecords(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'rnd_records');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filtered Records
  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      if (filterStartDate && record.date < filterStartDate) return false;
      if (filterEndDate && record.date > filterEndDate) return false;
      if (filterTaskType !== '전체' && record.taskType !== filterTaskType) return false;
      if (filterResult !== '전체' && record.result !== filterResult) return false;
      if (filterEngineer && !record.engineer.toLowerCase().includes(filterEngineer.toLowerCase())) return false;
      return true;
    });
  }, [records, filterStartDate, filterEndDate, filterTaskType, filterResult, filterEngineer]);

  // KPIs
  const kpis = useMemo(() => {
    const now = new Date();
    const currentMonthRecords = records.filter(r => isSameMonth(parseISO(r.date), now));
    const lastMonthRecords = records.filter(r => isSameMonth(parseISO(r.date), startOfMonth(subWeeks(now, 4))));

    const totalMonthly = currentMonthRecords.length;
    const lastMonthly = lastMonthRecords.length;
    const monthlyGrowth = lastMonthly === 0 ? 0 : ((totalMonthly - lastMonthly) / lastMonthly) * 100;

    const completedMonthly = currentMonthRecords.filter(r => r.result !== '진행중');
    const passedMonthly = completedMonthly.filter(r => r.result === '합격').length;
    const passRate = completedMonthly.length === 0 ? 0 : (passedMonthly / completedMonthly.length) * 100;

    const inProgress = records.filter(r => r.result === '진행중').length;

    const safetyFactors = completedMonthly.filter(r => r.safetyFactor !== undefined && r.safetyFactor !== null).map(r => r.safetyFactor as number);
    const avgSafetyFactor = safetyFactors.length === 0 ? 0 : safetyFactors.reduce((a, b) => a + b, 0) / safetyFactors.length;

    return { totalMonthly, monthlyGrowth, passRate, inProgress, avgSafetyFactor };
  }, [records]);

  // Chart Data
  const donutData = useMemo(() => {
    const now = new Date();
    const currentMonthRecords = records.filter(r => isSameMonth(parseISO(r.date), now));
    const passed = currentMonthRecords.filter(r => r.result === '합격').length;
    const failed = currentMonthRecords.filter(r => r.result === '불합격').length;
    const inProgress = currentMonthRecords.filter(r => r.result === '진행중').length;

    return {
      labels: ['합격', '불합격', '진행중'],
      datasets: [{
        data: [passed, failed, inProgress],
        backgroundColor: ['#10b981', '#ef4444', '#f59e0b'],
        borderWidth: 0,
      }]
    };
  }, [records]);

  const barData = useMemo(() => {
    const types: TaskType[] = ['CAE해석', '강도시험', '내구시험', '설계검토'];
    const counts = types.map(type => records.filter(r => r.taskType === type).length);

    return {
      labels: types,
      datasets: [{
        label: '업무 유형별 누적 건수',
        data: counts,
        backgroundColor: '#3b82f6',
        borderRadius: 4,
      }]
    };
  }, [records]);

  const lineData = useMemo(() => {
    const weeks = Array.from({ length: 8 }).map((_, i) => {
      const d = subWeeks(new Date(), 7 - i);
      return {
        start: startOfWeek(d, { weekStartsOn: 1 }),
        end: endOfWeek(d, { weekStartsOn: 1 }),
        label: `${format(d, 'M/d')} 주차`
      };
    });

    const counts = weeks.map(w => {
      return records.filter(r => {
        const d = parseISO(r.date);
        return isWithinInterval(d, { start: w.start, end: w.end }) && r.result !== '진행중';
      }).length;
    });

    return {
      labels: weeks.map(w => w.label),
      datasets: [{
        label: '주간 처리 완료 건수',
        data: counts,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
      }]
    };
  }, [records]);

  // Handlers
  const handleOpenModal = (record?: RndRecord) => {
    if (record) {
      setEditingRecord(record);
      setFormData({
        date: record.date,
        partCode: record.partCode,
        engineer: record.engineer,
        taskType: record.taskType,
        result: record.result,
        safetyFactor: record.safetyFactor?.toString() || '',
        notes: record.notes || ''
      });
    } else {
      setEditingRecord(null);
      setFormData({
        date: format(new Date(), 'yyyy-MM-dd'),
        partCode: '',
        engineer: '',
        taskType: 'CAE해석',
        result: '진행중',
        safetyFactor: '',
        notes: ''
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        date: formData.date,
        partCode: formData.partCode.toUpperCase(),
        engineer: formData.engineer,
        taskType: formData.taskType,
        result: formData.result,
        safetyFactor: formData.safetyFactor ? parseFloat(formData.safetyFactor) : null,
        notes: formData.notes,
        updatedAt: serverTimestamp()
      };

      if (editingRecord) {
        await updateDoc(doc(db, 'rnd_records', editingRecord.id), payload);
      } else {
        await addDoc(collection(db, 'rnd_records'), {
          ...payload,
          createdAt: serverTimestamp()
        });
      }
      setIsModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, editingRecord ? OperationType.UPDATE : OperationType.CREATE, 'rnd_records');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('정말 삭제하시겠습니까?')) {
      try {
        await deleteDoc(doc(db, 'rnd_records', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `rnd_records/${id}`);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 text-slate-300 fixed h-full z-20">
        <div className="p-6">
          <h1 className="text-white font-bold text-xl tracking-tight leading-tight">Seongwoo Hitech</h1>
          <p className="text-slate-500 text-xs uppercase tracking-widest mt-1">R&D Division</p>
        </div>
        <nav className="flex-1 px-4 py-4 space-y-1">
          <a href="#" className="flex items-center gap-3 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium">
            <LayoutDashboard size={18} />
            <span>대시보드</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800 rounded-lg transition-colors">
            <Wrench size={18} />
            <span>엔지니어링</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800 rounded-lg transition-colors">
            <BarChart3 size={18} />
            <span>분석 통계</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800 rounded-lg transition-colors">
            <TableIcon size={18} />
            <span>전체 기록</span>
          </a>
        </nav>
        <div className="p-4">
          <a href="#" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800 rounded-lg transition-colors">
            <Settings size={18} />
            <span>설정</span>
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 flex flex-col min-h-screen">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 sticky top-0 z-10">
          <h2 className="text-lg font-bold text-slate-800">A-R&D 연구 실적 관리</h2>
          <div className="flex items-center gap-4">
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                placeholder="검색..." 
                className="pl-9 pr-4 py-1.5 bg-slate-100 border-transparent rounded-full text-sm focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all w-64"
              />
            </div>
            <button className="text-slate-400 hover:text-slate-600 transition-colors"><Bell size={20} /></button>
            <button className="text-slate-400 hover:text-slate-600 transition-colors"><UserCircle size={24} /></button>
          </div>
        </header>

        <div className="p-6 flex-1 space-y-6 pb-24 md:pb-6">
          {/* Filters */}
          <section className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">시작일</label>
              <input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">종료일</label>
              <input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">업무 유형</label>
              <select value={filterTaskType} onChange={e => setFilterTaskType(e.target.value as any)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none min-w-[120px]">
                <option value="전체">전체</option>
                <option value="CAE해석">CAE해석</option>
                <option value="강도시험">강도시험</option>
                <option value="내구시험">내구시험</option>
                <option value="설계검토">설계검토</option>
                <option value="기타">기타</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">결과</label>
              <select value={filterResult} onChange={e => setFilterResult(e.target.value as any)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none min-w-[100px]">
                <option value="전체">전체</option>
                <option value="합격">합격</option>
                <option value="불합격">불합격</option>
                <option value="진행중">진행중</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">담당자</label>
              <input type="text" placeholder="이름 검색..." value={filterEngineer} onChange={e => setFilterEngineer(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none w-full" />
            </div>
          </section>

          {/* KPIs */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-500">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">이번 달 총 건수</p>
                  <h3 className="text-2xl font-bold text-slate-800">{kpis.totalMonthly}</h3>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><Activity size={20} /></div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs">
                <span className={`font-medium ${kpis.monthlyGrowth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {kpis.monthlyGrowth >= 0 ? '+' : ''}{kpis.monthlyGrowth.toFixed(1)}%
                </span>
                <span className="text-slate-400">전월 대비</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-emerald-500">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">합격률 (%)</p>
                  <h3 className="text-2xl font-bold text-slate-800">{kpis.passRate.toFixed(1)}%</h3>
                </div>
                <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600"><CheckCircle2 size={20} /></div>
              </div>
              <div className="mt-4 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${kpis.passRate}%` }}></div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-amber-500">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">진행중 건수</p>
                  <h3 className="text-2xl font-bold text-slate-800">{kpis.inProgress}</h3>
                </div>
                <div className="p-2 bg-amber-50 rounded-lg text-amber-600"><Clock size={20} /></div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <span className="text-slate-500">현재 병목 확인 필요</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-indigo-500">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">평균 안전계수</p>
                  <h3 className="text-2xl font-bold text-slate-800">{kpis.avgSafetyFactor.toFixed(2)}</h3>
                </div>
                <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600"><Shield size={20} /></div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs">
                <span className="text-slate-500">권장 기준치: 1.5 이상</span>
              </div>
            </div>
          </section>

          {/* Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
              <h4 className="text-sm font-bold text-slate-800 mb-4">이번 달 결과 현황</h4>
              <div className="flex-1 relative min-h-[200px] flex items-center justify-center">
                <Doughnut 
                  data={donutData} 
                  options={{ 
                    cutout: '75%', 
                    plugins: { 
                      legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } 
                    },
                    maintainAspectRatio: false
                  }} 
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
                  <span className="text-3xl font-bold text-slate-800">{kpis.totalMonthly}</span>
                  <span className="text-[10px] font-semibold text-slate-500 uppercase">Total</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
              <h4 className="text-sm font-bold text-slate-800 mb-4">업무 유형별 누적 건수</h4>
              <div className="flex-1 min-h-[200px]">
                <Bar 
                  data={barData} 
                  options={{
                    indexAxis: 'y',
                    plugins: { legend: { display: false } },
                    scales: { x: { grid: { display: false } }, y: { grid: { display: false } } },
                    maintainAspectRatio: false
                  }} 
                />
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
              <h4 className="text-sm font-bold text-slate-800 mb-4">주간 처리 완료 추이</h4>
              <div className="flex-1 min-h-[200px]">
                <Line 
                  data={lineData} 
                  options={{
                    plugins: { legend: { display: false } },
                    scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
                    maintainAspectRatio: false
                  }} 
                />
              </div>
            </div>
          </section>

          {/* Table */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <h4 className="text-sm font-bold text-slate-800">최근 기록 (최대 20건)</h4>
              <button 
                onClick={() => handleOpenModal()}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors shadow-sm"
              >
                <Plus size={16} /> 기록 추가
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="px-4 py-3">날짜</th>
                    <th className="px-4 py-3">부품코드</th>
                    <th className="px-4 py-3">엔지니어</th>
                    <th className="px-4 py-3">업무유형</th>
                    <th className="px-4 py-3">결과</th>
                    <th className="px-4 py-3">안전계수</th>
                    <th className="px-4 py-3 text-right">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">데이터를 불러오는 중...</td></tr>
                  ) : filteredRecords.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">조건에 맞는 기록이 없습니다.</td></tr>
                  ) : (
                    filteredRecords.slice(0, 20).map(record => (
                      <tr key={record.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="px-4 py-3 text-sm text-slate-600">{record.date}</td>
                        <td className="px-4 py-3 text-sm font-bold text-slate-800">{record.partCode}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{record.engineer}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{record.taskType}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-bold ${
                            record.result === '합격' ? 'bg-emerald-100 text-emerald-700' :
                            record.result === '불합격' ? 'bg-red-100 text-red-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {record.result}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-slate-600">{record.safetyFactor ?? '-'}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleOpenModal(record)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Edit size={16} /></button>
                            <button onClick={() => handleDelete(record.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"><Trash2 size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">{editingRecord ? '기록 수정' : '새 기록 추가'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><XCircle size={24} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">날짜 *</label>
                  <input required type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">부품 코드 *</label>
                  <input required type="text" placeholder="예: SUS-A001" value={formData.partCode} onChange={e => setFormData({...formData, partCode: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none uppercase" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">담당 엔지니어 *</label>
                  <input required type="text" value={formData.engineer} onChange={e => setFormData({...formData, engineer: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">업무 유형 *</label>
                  <select required value={formData.taskType} onChange={e => setFormData({...formData, taskType: e.target.value as TaskType})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="CAE해석">CAE해석</option>
                    <option value="강도시험">강도시험</option>
                    <option value="내구시험">내구시험</option>
                    <option value="설계검토">설계검토</option>
                    <option value="기타">기타</option>
                  </select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-semibold text-slate-600">결과 *</label>
                  <div className="flex gap-3">
                    {['합격', '불합격', '진행중'].map(res => (
                      <label key={res} className="flex-1 cursor-pointer">
                        <input type="radio" name="result" value={res} checked={formData.result === res} onChange={e => setFormData({...formData, result: e.target.value as ResultType})} className="hidden peer" />
                        <div className={`text-center py-2 text-sm font-medium rounded-lg border transition-all ${
                          formData.result === res 
                            ? (res === '합격' ? 'bg-emerald-500 text-white border-emerald-500' : res === '불합격' ? 'bg-red-500 text-white border-red-500' : 'bg-amber-500 text-white border-amber-500')
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}>
                          {res}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-semibold text-slate-600">안전계수</label>
                  <input type="number" step="0.1" placeholder="예: 1.5" value={formData.safetyFactor} onChange={e => setFormData({...formData, safetyFactor: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-semibold text-slate-600">비고</label>
                  <textarea rows={3} value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"></textarea>
                </div>
              </div>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors">취소</button>
                <button type="submit" className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-sm">저장하기</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 w-full bg-white border-t border-slate-200 flex justify-around items-center py-3 pb-safe z-20">
        <button className="flex flex-col items-center gap-1 text-blue-600">
          <LayoutDashboard size={20} />
          <span className="text-[10px] font-bold">홈</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600">
          <Wrench size={20} />
          <span className="text-[10px] font-bold">엔지니어링</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600">
          <BarChart3 size={20} />
          <span className="text-[10px] font-bold">통계</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600">
          <TableIcon size={20} />
          <span className="text-[10px] font-bold">기록</span>
        </button>
      </nav>
    </div>
  );
}
