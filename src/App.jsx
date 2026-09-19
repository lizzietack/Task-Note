import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, Bell, CalendarCheck2, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight,
  Circle, Clock3, File, FileText, Image as ImageIcon, Inbox, ListTodo, Menu, Mic, MoreHorizontal,
  NotebookPen, Paperclip, Pin, Play, Plus, Search, Square, Tag, Trash2, X, Cloud, RefreshCw, WifiOff, Mail, LockKeyhole, Users
} from 'lucide-react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useDaymarkCloud } from './hooks/useDaymarkCloud';
import { useDaymarkAuth } from './hooks/useDaymarkAuth';
import { useCollaboration } from './hooks/useCollaboration';
import { migrateAccountCache } from './lib/accountCache';
import { ContactsView, AssignedView, AssignedDetail, NotificationBell, CollaborationHealth, AssignmentPicker, TaskCollaboration } from './components/Collaboration';
import { AccountSettings, ProfileAvatar, ThemeSwitch, accountDisplayName } from './components/AccountSettings';

const CATEGORIES = [
  { name: 'Personal', color: '#0F766E' },
  { name: 'Work', color: '#315C91' },
  { name: 'Shopping', color: '#A16207' },
  { name: 'Finance', color: '#6D4C8C' },
  { name: 'Health', color: '#B4535A' },
  { name: 'Ideas', color: '#3F6212' },
];

const initialTasks = [
  { id: 101, title: 'Review this week’s priorities', completed: false, date: isoToday(), time: '09:00', priority: 'high', category: 'Work', list: 'today', repeat: 'none', reminder: 'At time', note: 'Keep today realistic: choose the few things that really matter.', subtasks: [], createdAt: Date.now() - 5000 },
  { id: 102, title: 'Pick up groceries', completed: false, date: isoToday(), time: '17:30', priority: 'medium', category: 'Shopping', list: 'today', repeat: 'none', reminder: '30 minutes before', note: '', subtasks: [{id:1,text:'Rice',done:false},{id:2,text:'Fruit',done:false}], createdAt: Date.now() - 4000 },
  { id: 103, title: 'Backup important files', completed: false, date: addDaysISO(3), time: '', priority: 'low', category: 'Personal', list: 'upcoming', repeat: 'monthly', reminder: '1 day before', note: '', subtasks: [], createdAt: Date.now() - 3000 },
];

const initialNotes = [
  { id: 201, title: 'Things worth remembering', body: 'Keep important details here — account references, measurements, ideas, or anything you do not want to lose.', type: 'text', pinned: true, archived: false, label: 'Personal', color: 'sand', checklist: [], attachments: [], createdAt: Date.now() - 3000, updatedAt: Date.now() - 3000 },
  { id: 202, title: 'Weekend errands', body: '', type: 'checklist', pinned: false, archived: false, label: 'Shopping', color: 'mint', checklist: [{id:1,text:'Laundry',done:false},{id:2,text:'Car wash',done:false},{id:3,text:'Buy household supplies',done:true}], attachments: [], createdAt: Date.now() - 2000, updatedAt: Date.now() - 2000 },
];

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDaysISO(days) {
  const d = new Date(); d.setDate(d.getDate()+days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatDate(date) {
  if (!date) return 'No date';
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
}
function sameDay(a,b){return a===b;}
function isPast(date){return date && date < isoToday();}
function nextRepeatDate(date, repeat){
  if(!date || repeat==='none') return '';
  const d=new Date(`${date}T12:00:00`);
  if(repeat==='daily') d.setDate(d.getDate()+1);
  if(repeat==='weekly') d.setDate(d.getDate()+7);
  if(repeat==='monthly') d.setMonth(d.getMonth()+1);
  if(repeat==='yearly') d.setFullYear(d.getFullYear()+1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function taskListForDate(date,currentList='inbox'){
  if(currentList==='later') return 'later';
  if(!date) return 'inbox';
  if(date===isoToday()) return 'today';
  return date>isoToday()?'upcoming':'today';
}
function reminderTimestamp(task){
  if(!task?.date || !task?.reminder || task.reminder==='None') return null;
  const base=new Date(`${task.date}T${task.time||'09:00'}:00`).getTime();
  const offsets={'At time':0,'10 minutes before':10*60e3,'30 minutes before':30*60e3,'1 hour before':60*60e3,'1 day before':24*60*60e3,'Keep reminding until completed':0};
  return Number.isFinite(base)?base-(offsets[task.reminder]??0):null;
}

function parseCapture(text) {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const looksNote = /^(remember|note|idea|save this|remember this)\b/.test(lower);
  let date = '';
  if (/\btomorrow\b/.test(lower)) date = addDaysISO(1);
  else if (/\btoday\b/.test(lower)) date = isoToday();
  let time = '';
  const tm = lower.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(am|pm)\b/);
  if (tm) {
    let h = Number(tm[1]); const min = tm[2] || '00';
    if (tm[3] === 'pm' && h !== 12) h += 12;
    if (tm[3] === 'am' && h === 12) h = 0;
    time = `${String(h).padStart(2,'0')}:${min}`;
  }
  let title = raw
    .replace(/^remember(?: this)?(?: that)?\s*/i,'')
    .replace(/^note\s*:?\s*/i,'')
    .replace(/^idea\s*:?\s*/i,'')
    .replace(/\b(today|tomorrow)\b/gi,'')
    .replace(/\b(1[0-2]|0?[1-9])(?::[0-5]\d)?\s?(am|pm)\b/gi,'')
    .replace(/\s+/g,' ').trim();
  return { kind: looksNote ? 'note' : 'task', title: title || raw, date, time };
}

export default function App(){
  const auth = useDaymarkAuth();
  const [passwordReadyUser, setPasswordReadyUser] = useState(null);
  if (auth.authLoading) return <AppLoading/>;
  if (!auth.configured) return <ConfigError/>;
  if (!auth.session) return <AuthScreen signIn={auth.signIn} signUp={auth.signUp} requestPasswordReset={auth.requestPasswordReset}/>;
  const url = new URL(window.location.href);
  const metadata = auth.session.user.user_metadata || {};
  const forcedSetup = url.searchParams.get('daymark_setup') === '1' || url.searchParams.get('daymark_password_reset') === '1';
  const invitedWithoutPassword = metadata.daymark_invitation === true && metadata.daymark_password_created !== true;
  const passwordSetupRequired = forcedSetup || (invitedWithoutPassword && passwordReadyUser !== auth.session.user.id);
  const finishPasswordSetup = () => {
    setPasswordReadyUser(auth.session.user.id);
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('daymark_setup');
    currentUrl.searchParams.delete('daymark_password_reset');
    window.history.replaceState({}, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  };
  return <Workspace key={auth.session.user.id} auth={auth} passwordSetupRequired={passwordSetupRequired} onPasswordSetupComplete={finishPasswordSetup}/>;
}

function Workspace({auth,passwordSetupRequired,onPasswordSetupComplete}){
  useState(() => { migrateAccountCache(localStorage, auth.session.user.id, initialTasks, initialNotes); });
  const [tasks,setTasks] = useLocalStorage(`daymark.${auth.session.user.id}.tasks.v1`, initialTasks);
  const [notes,setNotes] = useLocalStorage(`daymark.${auth.session.user.id}.notes.v1`, initialNotes);
  const [dark,setDark] = useLocalStorage('daily-organizer.dark.v2', false);
  const [tab,setTab] = useState('today');
  const [sidebar,setSidebar] = useState(false);
  const [composer,setComposer] = useState(false);
  const [composerMode,setComposerMode] = useState('quick');
  const [quickText,setQuickText] = useState('');
  const [editingTask,setEditingTask] = useState(null);
  const [editingNote,setEditingNote] = useState(null);
  const [search,setSearch] = useState('');
  const [taskView,setTaskView] = useState('all');
  const [month,setMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [taskDefaults,setTaskDefaults] = useState({});
  const cloud = { ...useDaymarkCloud({ tasks, setTasks, notes, setNotes, session: auth.session }), ...auth };
  const collaboration = useCollaboration(auth.session);
  const [assignedDetail, setAssignedDetail] = useState(null);
  const [accountSettings, setAccountSettings] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pendingInviteToken, setPendingInviteToken] = useState(() => {
    const urlToken = new URL(window.location.href).searchParams.get('daymark_invite');
    if (urlToken) localStorage.setItem('daymark.pending-email-invite.v1', urlToken);
    return urlToken || localStorage.getItem('daymark.pending-email-invite.v1') || '';
  });
  const claimStarted = useRef(false);
  const ownProfile = collaboration.profiles[auth.session.user.id];
  const displayName = accountDisplayName(ownProfile, auth.session.user);
  const navigateNotification = notification => {
    if (notification.connection_id) { setTab('contacts'); return; }
    const a = collaboration.assignments.find(a => a.id === notification.assignment_id);
    if (a?.assignee_id === auth.session.user.id) { setTab('assigned'); setAssignedDetail(a.id); return; }
    const task = tasks.find(t => String(t.id) === String(notification.task_id));
    if (task) openTaskEditor(task);
    else { setTab('assigned'); setNotice({ tone: 'error', text: 'This task is no longer available, or your access has changed.' }); }
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const token = pendingInviteToken;
    if (!token || claimStarted.current) return;
    claimStarted.current = true;
    collaboration.act('claimEmailInvite', token).then(result => {
      setTab(result?.task_id ? 'assigned' : 'contacts');
      setNotice({ tone: 'success', text: result?.task_id ? 'Invitation claimed. The task is ready for you to accept or decline.' : 'Invitation claimed. You are now connected on Daymark.' });
    }).catch(error => setNotice({ tone: 'error', text: error.message || 'This invitation could not be claimed.' })).finally(() => {
      localStorage.removeItem('daymark.pending-email-invite.v1');
      setPendingInviteToken('');
      url.searchParams.delete('daymark_invite');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    });
  }, [collaboration.act, pendingInviteToken]);


  useEffect(()=>{
    if(typeof window==='undefined' || !('Notification' in window) || Notification.permission!=='granted') return;
    const key='daymark.notifications.sent.v1';
    const check=()=>{
      const now=Date.now();
      let sent={};
      try{sent=JSON.parse(localStorage.getItem(key)||'{}')}catch{sent={}}
      let changed=false;
      tasks.filter(t=>!t.completed).forEach(task=>{
        const at=reminderTimestamp(task); if(!at || now<at) return;
        const persistent=task.reminder==='Keep reminding until completed';
        const slot=persistent?Math.floor((now-at)/(15*60e3)):0;
        if(!persistent && now-at>2*60e3) return;
        const token=`${task.id}:${at}:${slot}`; if(sent[token]) return;
        const notification=new Notification('Daymark reminder',{body:task.title,tag:`daymark-${task.id}`,renotify:persistent});
        notification.onclick=()=>{window.focus();notification.close()};
        sent[token]=now; changed=true;
      });
      if(changed){
        const cutoff=now-14*24*60*60e3;
        Object.keys(sent).forEach(k=>{if(sent[k]<cutoff)delete sent[k]});
        try{localStorage.setItem(key,JSON.stringify(sent))}catch{}
      }
    };
    check(); const timer=setInterval(check,30000); return()=>clearInterval(timer);
  },[tasks]);

  useEffect(() => {
    const modalOpen = composer || editingTask || editingNote || assignedDetail || accountSettings;
    if (!modalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [composer, editingTask, editingNote, assignedDetail, accountSettings]);

  useEffect(() => {
    if (!sidebar) return;
    const closeOnEscape = event => { if (event.key === 'Escape') setSidebar(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [sidebar]);

  const openAdd=(mode='quick', defaults={})=>{setEditingTask(null);setEditingNote(null);setTaskDefaults(defaults);setComposerMode(mode);setComposer(true);};
  const openTaskEditor=(task)=>{setComposer(false);setComposerMode('quick');setTaskDefaults({});setEditingNote(null);setEditingTask(task);};
  const addTaskForDate=(date)=>{openAdd('task',{date,list:taskListForDate(date)});};
  const openNoteEditor=(note)=>{setComposer(false);setComposerMode('quick');setEditingTask(null);setEditingNote(note);};
  const addQuick=(overrides={})=>{
    if(!quickText.trim()) return;
    const parsed = parseCapture(quickText);
    const kind=overrides.kind||parsed.kind;
    const date=overrides.date!==undefined?overrides.date:parsed.date;
    const time=overrides.time!==undefined?overrides.time:parsed.time;
    if(kind==='note'){
      setNotes(prev=>[{id:crypto.randomUUID(),title:parsed.title,body:'',type:'text',pinned:false,archived:false,label:'Personal',color:'plain',checklist:[],attachments:[],source:{type:'manual'},createdAt:Date.now(),updatedAt:Date.now()},...prev]);
    } else {
      setTasks(prev=>[{id:crypto.randomUUID(),title:parsed.title,completed:false,date,time,priority:'medium',category:'Personal',list:taskListForDate(date),repeat:'none',reminder:time?'At time':'None',note:'',subtasks:[],source:{type:'manual'},createdAt:Date.now()},...prev]);
    }
    setQuickText(''); setComposer(false);
  };

  const completeTask=(id)=>setTasks(prev=>{
    const target=prev.find(t=>t.id===id);
    if(!target) return prev;
    const completing=!target.completed;
    const updated=prev.map(t=>t.id===id?{...t,completed:completing,completedAt:completing?Date.now():null,updatedAt:Date.now()}:t);
    if(completing && target.repeat && target.repeat!=='none' && target.date){
      const nextDate=nextRepeatDate(target.date,target.repeat);
      const alreadyExists=updated.some(t=>!t.completed && t.recurringFrom===target.id && t.date===nextDate);
      if(nextDate && !alreadyExists){
        updated.unshift({...target,id:crypto.randomUUID(),completed:false,completedAt:null,date:nextDate,list:taskListForDate(nextDate,target.list),subtasks:(target.subtasks||[]).map(s=>({...s,done:false})),recurringFrom:target.id,createdAt:Date.now(),updatedAt:Date.now()});
      }
    }
    return updated;
  });
  const deleteTask=(id)=>{if(window.confirm('Delete this task? This cannot be undone.')){cloud.deleteEntity('task',id);setTasks(prev=>prev.filter(t=>String(t.id)!==String(id)));}};
  const saveTask=async (task, assigneeId, inviteEmail, onLocalSave)=>{
    const normalized={...task,id:task.id || crypto.randomUUID(),createdAt:task.createdAt || Date.now(),list:taskListForDate(task.date,task.list),updatedAt:Date.now()};
    setTasks(prev=>prev.some(t=>String(t.id)===String(normalized.id)) ? prev.map(t=>String(t.id)===String(normalized.id)?normalized:t) : [normalized,...prev]);
    onLocalSave?.(normalized);
    if (assigneeId || inviteEmail) {
      try {
        await cloud.persistTask(normalized);
        if (assigneeId) await collaboration.act('assign', normalized.id, assigneeId);
        if (inviteEmail) {
          await collaboration.act('inviteTaskByEmail', inviteEmail, normalized.id, normalized.title);
          setNotice({ tone: 'success', text: `Invitation sent to ${inviteEmail.trim().toLowerCase()}. They can join securely and accept or decline the task.` });
        }
      } catch (err) { throw new Error(`Task saved. ${inviteEmail ? 'Email invitation' : 'Assignment'} was not confirmed: ${err.message} Check its status before retrying.`); }
    }
    setEditingTask(null); setComposer(false); setTaskDefaults({});
  };
  const saveNote=(note)=>{
    if(note.id) setNotes(prev=>prev.map(n=>n.id===note.id?{...note,updatedAt:Date.now()}:n));
    else setNotes(prev=>[{...note,id:crypto.randomUUID(),createdAt:Date.now(),updatedAt:Date.now()},...prev]);
    setEditingNote(null); setComposer(false);
  };
  const deleteNote=(id)=>{cloud.deleteEntity('note',id);setNotes(prev=>prev.filter(n=>String(n.id)!==String(id)));};
  const toggleNoteChecklist=(noteId,itemId)=>setNotes(prev=>prev.map(note=>note.id===noteId
    ? {...note,checklist:note.checklist.map(item=>item.id===itemId?{...item,done:!item.done}:item),updatedAt:Date.now()}
    : note));
  const convertNote=(note)=>{
    const generated = note.type==='checklist' && note.checklist.length
      ? note.checklist.filter(i=>!i.done).map((i,idx)=>({id:crypto.randomUUID(),title:i.text,completed:false,date:'',time:'',priority:'medium',category:note.label||'Personal',list:'inbox',repeat:'none',reminder:'None',note:`Created from note: ${note.title}`,subtasks:[],createdAt:Date.now()}))
      : [{id:crypto.randomUUID(),title:note.title||note.body.slice(0,80),completed:false,date:'',time:'',priority:'medium',category:note.label||'Personal',list:'inbox',repeat:'none',reminder:'None',note:note.body,subtasks:[],createdAt:Date.now()}];
    setTasks(prev=>[...generated,...prev]); setTab('tasks'); setTaskView('inbox');
  };

  const counts = useMemo(()=>({
    today:tasks.filter(t=>!t.completed && sameDay(t.date,isoToday())).length,
    inbox:tasks.filter(t=>!t.completed && (!t.date || t.list==='inbox')).length,
    upcoming:tasks.filter(t=>!t.completed && t.date>isoToday()).length,
    later:tasks.filter(t=>!t.completed && t.list==='later').length,
  }),[tasks]);

  if (cloud.authLoading) return <AppLoading/>;
  if (!cloud.configured) return <ConfigError/>;
  if (!cloud.session) return <AuthScreen signIn={cloud.signIn} signUp={cloud.signUp}/>;

  return <div className={dark?'app dark':'app'}>
    {sidebar && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={()=>setSidebar(false)}/>}
    <aside id="daymark-sidebar" className={sidebar?'sidebar open':'sidebar'}>
      <div className="brand"><div className="brand-mark"><CheckCircle2 size={22}/></div><div><strong>Daymark</strong><span>Tasks & notes</span></div><button className="icon mobile-close" aria-label="Close navigation panel" onClick={()=>setSidebar(false)}><X/></button></div>
      <nav className="nav">
        <NavItem icon={CalendarCheck2} label="Today" active={tab==='today'} count={counts.today} onClick={()=>{setTab('today');setSidebar(false)}}/>
        <NavItem icon={ListTodo} label="Tasks" active={tab==='tasks'} onClick={()=>{setTab('tasks');setSidebar(false)}}/>
        <NavItem icon={Users} label="Assigned to me" active={tab==='assigned'} count={collaboration.assignments.filter(a=>a.assignee_id===auth.session.user.id && ['pending','accepted'].includes(a.status)).length} onClick={()=>{setTab('assigned');setSidebar(false)}}/>
        <NavItem icon={Users} label="Contacts" active={tab==='contacts'} count={collaboration.connections.filter(c=>c.addressee_id===auth.session.user.id && c.status==='pending').length} onClick={()=>{setTab('contacts');setSidebar(false)}}/>
        <NavItem icon={FileText} label="Notes" active={tab==='notes'} onClick={()=>{setTab('notes');setSidebar(false)}}/>
        <NavItem icon={CalendarDays} label="Calendar" active={tab==='calendar'} onClick={()=>{setTab('calendar');setSidebar(false)}}/>
        <NavItem icon={Search} label="Search" active={tab==='search'} onClick={()=>{setTab('search');setSidebar(false)}}/>
      </nav>
      <div className="side-section"><span>QUICK LISTS</span>
        <button onClick={()=>{setTab('tasks');setTaskView('inbox')}}><Inbox size={17}/> Inbox <b>{counts.inbox}</b></button>
        <button onClick={()=>{setTab('tasks');setTaskView('upcoming')}}><Clock3 size={17}/> Upcoming <b>{counts.upcoming}</b></button>
        <button onClick={()=>{setTab('tasks');setTaskView('later')}}><Archive size={17}/> Later <b>{counts.later}</b></button>
      </div>
      <div className="sidebar-bottom">
        <CloudStatus cloud={cloud}/>
        <button className="sidebar-profile" onClick={()=>{setAccountSettings(true);setSidebar(false)}}><ProfileAvatar profile={ownProfile} user={auth.session.user} small/><span className="account-copy"><strong>{displayName}</strong><span>Profile & settings</span></span><ChevronRight size={17}/></button>
        <div className="sidebar-tip"><NotebookPen size={18}/><div><strong>Capture first.</strong><span>Organize when you have time.</span></div></div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar">
        <button className="icon menu" aria-label="Open navigation" aria-expanded={sidebar} aria-controls="daymark-sidebar" onClick={()=>setSidebar(true)}><Menu/></button>
        <div className="top-spacer"/><NotificationBell c={collaboration} onNavigate={navigateNotification}/>
        <ThemeSwitch dark={dark} setDark={setDark} compact/>
        <button className="add-top" onClick={()=>openAdd('quick')}><Plus size={19}/> <span>Add</span></button>
      </header>
      <div className="content">
        <CollaborationHealth c={collaboration}/>
        {notice && <div className={notice.tone === 'success' ? 'inline-success app-notice' : 'inline-error app-notice'} role="status">{notice.text}<button className="text-btn" onClick={()=>setNotice(null)}>Dismiss</button></div>}
        {tab==='contacts' && <ContactsView c={collaboration}/>}
        {tab==='assigned' && <AssignedView c={collaboration} onOpen={setAssignedDetail}/>}
        {tab==='today' && <TodayView tasks={tasks} notes={notes} completeTask={completeTask} setEditingTask={openTaskEditor} setEditingNote={openNoteEditor} toggleNoteChecklist={toggleNoteChecklist} openAdd={openAdd} setTab={setTab}/>} 
        {tab==='tasks' && <TasksView tasks={tasks} view={taskView} setView={setTaskView} completeTask={completeTask} setEditingTask={openTaskEditor} deleteTask={deleteTask} openAdd={openAdd}/>} 
        {tab==='notes' && <NotesView notes={notes} setNotes={setNotes} setEditingNote={openNoteEditor} toggleNoteChecklist={toggleNoteChecklist} convertNote={convertNote} openAdd={openAdd}/>} 
        {tab==='calendar' && <CalendarView tasks={tasks} month={month} setMonth={setMonth} completeTask={completeTask} editTask={openTaskEditor} addTaskForDate={addTaskForDate}/>} 
        {tab==='search' && <SearchView search={search} setSearch={setSearch} tasks={tasks} notes={notes} completeTask={completeTask} setEditingTask={openTaskEditor} setEditingNote={openNoteEditor} toggleNoteChecklist={toggleNoteChecklist}/>} 
      </div>
    </main>

    {assignedDetail && <AssignedDetail c={collaboration} assignmentId={assignedDetail} onClose={()=>setAssignedDetail(null)}/>}
    {accountSettings && <AccountSettings auth={auth} profile={ownProfile} dark={dark} setDark={setDark} onSaved={collaboration.refresh} onClose={()=>setAccountSettings(false)}/>}
    <button className="fab" onClick={()=>openAdd('quick')} aria-label="Add"><Plus/></button>

    {(composer || editingTask || editingNote) && <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setComposer(false);setEditingTask(null);setEditingNote(null)}}}>
      {editingTask ? <TaskEditor collaboration={collaboration} key={`task-${editingTask.id}`} task={editingTask} onSave={saveTask} onClose={()=>{setEditingTask(null);setComposer(false)}}/> :
       editingNote ? <NoteEditor key={`note-${editingNote.id}`} note={editingNote} onSave={saveNote} onDelete={deleteNote} onClose={()=>{setEditingNote(null);setComposer(false)}}/> :
       composerMode==='task' ? <TaskEditor collaboration={collaboration} key={`new-task-${taskDefaults.date||'blank'}`} task={null} defaults={taskDefaults} onSave={saveTask} onClose={()=>{setComposer(false);setTaskDefaults({})}}/> :
       composerMode==='note' ? <NoteEditor key="new-note" note={null} onSave={saveNote} onDelete={deleteNote} onClose={()=>setComposer(false)}/> :
       <QuickComposer quickText={quickText} setQuickText={setQuickText} addQuick={addQuick} onClose={()=>setComposer(false)} openTask={(defaults={})=>{setTaskDefaults(defaults);setComposerMode('task')}} openNote={()=>setComposerMode('note')}/>} 
    </div>}
    {passwordSetupRequired && <PasswordSetupGate email={auth.session.user.email} updatePassword={auth.updatePassword} onComplete={onPasswordSetupComplete}/>} 
  </div>
}

function NavItem({icon:Icon,label,active,count,onClick}){return <button className={active?'nav-item active':'nav-item'} onClick={onClick}><Icon size={19}/><span>{label}</span>{count>0&&<b>{count}</b>}</button>}

function PageHead({eyebrow,title,subtitle,action}){return <div className="page-head"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>}

function TodayView({tasks,notes,completeTask,setEditingTask,setEditingNote,toggleNoteChecklist,openAdd,setTab}){
  const today=tasks.filter(t=>!t.completed && sameDay(t.date,isoToday()));
  const overdue=tasks.filter(t=>!t.completed && isPast(t.date));
  const later=today.filter(t=>t.time).sort((a,b)=>a.time.localeCompare(b.time));
  const pinned=notes.filter(n=>n.pinned&&!n.archived).slice(0,3);
  const dateLabel=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  return <>
    <PageHead eyebrow={dateLabel} title="Today" subtitle="A calm view of what matters now." action={<button className="secondary" onClick={()=>openAdd('quick')}><Plus size={18}/> Quick add</button>}/>
    <section className="hero-card"><div><span className="hero-kicker">YOUR DAY</span><h2>{today.length===0?'You’re clear for today.':`${today.length} ${today.length===1?'thing':'things'} to move forward.`}</h2><p>{overdue.length?`${overdue.length} overdue ${overdue.length===1?'item needs':'items need'} attention.`:'Nothing overdue. Keep the day light.'}</p></div><div className="hero-ring"><strong>{today.length}</strong><span>today</span></div></section>
    {overdue.length>0&&<TaskSection title="Overdue" tasks={overdue} completeTask={completeTask} edit={setEditingTask}/>} 
    <TaskSection title="Today" tasks={today.filter(t=>!t.time)} completeTask={completeTask} edit={setEditingTask} empty="No unscheduled tasks today."/>
    {later.length>0&&<TaskSection title="Later today" tasks={later} completeTask={completeTask} edit={setEditingTask}/>} 
    <div className="section-row"><div><h2>Pinned notes</h2><p>Things you want within reach.</p></div><button className="text-btn" onClick={()=>setTab('notes')}>See all</button></div>
    <div className="notes-grid compact">{pinned.length?pinned.map(n=><NoteCard key={n.id} note={n} onClick={()=>setEditingNote(n)} onToggleChecklist={itemId=>toggleNoteChecklist(n.id,itemId)}/>):<EmptyCard title="Pin the things you reach for often" text="Important numbers, shopping lists, ideas and references can live here."/>}</div>
    <div className="capture-banner"><div className="capture-icon"><NotebookPen/></div><div><strong>Got something on your mind?</strong><span>Capture it before it disappears. You can organize it later.</span></div><button onClick={()=>openAdd('quick')}>Add something</button></div>
  </>
}

function TaskSection({title,tasks,completeTask,edit,empty}){return <section className="task-section"><div className="section-row"><h2>{title}</h2><span>{tasks.length}</span></div><div className="task-list">{tasks.length?tasks.map(t=><TaskRow key={t.id} task={t} completeTask={completeTask} edit={edit}/>):<div className="empty-line"><CheckCircle2 size={18}/>{empty||'Nothing here.'}</div>}</div></section>}

function TaskRow({task,completeTask,edit,showDelete,deleteTask}){return <div className={task.completed?'task-row done':'task-row'}><button className="check" onClick={()=>completeTask(task.id)}>{task.completed?<Check size={16}/>:null}</button><button className="task-main" onClick={()=>edit(task)}><strong>{task.title}</strong><span>{task.time&&<><Clock3 size={14}/>{task.time}</>} {task.category&&<><Tag size={14}/>{task.category}</>} {task.repeat!=='none'&&<>{task.repeat}</>}</span></button><div className={`priority ${task.priority}`}/>{showDelete&&<button className="icon tiny danger" onClick={()=>deleteTask(task.id)}><Trash2 size={16}/></button>}</div>}

function TasksView({tasks,view,setView,completeTask,setEditingTask,deleteTask,openAdd}){
  const filtered=tasks.filter(t=>{
    if(view==='inbox') return !t.date || t.list==='inbox';
    if(view==='today') return sameDay(t.date,isoToday());
    if(view==='upcoming') return t.date>isoToday() && t.list!=='later';
    if(view==='later') return t.list==='later';
    if(view==='completed') return t.completed;
    return !t.completed;
  });
  return <><PageHead eyebrow="YOUR LISTS" title="Tasks" subtitle="Keep commitments visible without over-organizing." action={<button className="primary" onClick={()=>openAdd('task')}><Plus size={18}/> New task</button>}/>
    <div className="segmented">{[['all','All'],['inbox','Inbox'],['today','Today'],['upcoming','Upcoming'],['later','Later'],['completed','Completed']].map(([v,l])=><button key={v} className={view===v?'active':''} onClick={()=>setView(v)}>{l}</button>)}</div>
    <div className="task-list large">{filtered.length?filtered.map(t=><TaskRow key={t.id} task={t} completeTask={completeTask} edit={setEditingTask} showDelete deleteTask={deleteTask}/>):<EmptyState icon={ListTodo} title="Nothing here" text="Your list is clear. Add something when it becomes worth remembering." action={()=>openAdd('quick')}/>}</div>
  </>
}

function NotesView({notes,setNotes,setEditingNote,toggleNoteChecklist,convertNote,openAdd}){
  const active=notes.filter(n=>!n.archived).sort((a,b)=>(b.pinned-a.pinned)||(b.updatedAt-a.updatedAt));
  return <><PageHead eyebrow="YOUR MEMORY" title="Notes" subtitle="Save useful details, lists and ideas without creating a filing system." action={<button className="primary" onClick={()=>openAdd('note')}><Plus size={18}/> New note</button>}/>
    <div className="notes-grid">{active.map(n=><NoteCard key={n.id} note={n} onClick={()=>setEditingNote(n)} onToggleChecklist={itemId=>toggleNoteChecklist(n.id,itemId)} actions={<div className="card-actions"><button className="icon tiny" title={n.pinned?'Unpin':'Pin'} onClick={e=>{e.stopPropagation();setNotes(prev=>prev.map(x=>x.id===n.id?{...x,pinned:!x.pinned,updatedAt:Date.now()}:x))}}><Pin size={15}/></button><button className="icon tiny" title="Create tasks from this note" onClick={e=>{e.stopPropagation();convertNote(n)}}><ListTodo size={15}/></button><button className="icon tiny" title="Open note" onClick={e=>{e.stopPropagation();setEditingNote(n)}}><MoreHorizontal size={15}/></button></div>}/>)}</div>
  </>
}

function NoteCard({note,onClick,actions,onToggleChecklist}){return <div role="button" tabIndex={0} className={`note-card ${note.color||'plain'}`} onClick={onClick} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onClick()}}}><div className="note-top">{note.pinned&&<Pin size={15}/>}<span>{note.label}</span>{actions}</div><h3>{note.title||'Untitled note'}</h3>{note.type==='checklist'?<div className="mini-checklist">{note.checklist.slice(0,6).map(i=><button key={i.id} type="button" className={i.done?'mini-check-item done':'mini-check-item'} onClick={e=>{e.stopPropagation();onToggleChecklist?.(i.id)}} aria-label={`${i.done?'Mark incomplete':'Mark complete'}: ${i.text}`}><span className={i.done?'mini-check-circle checked':'mini-check-circle'}>{i.done?<Check size={10}/>:null}</span><span>{i.text}</span></button>)}</div>:<p>{note.body||'No additional text'}</p>}<div className="note-card-foot"><small>{new Date(note.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</small>{note.type==='checklist'&&<span>Changes save instantly</span>}</div></div>}

function CalendarView({tasks,month,setMonth,completeTask,editTask,addTaskForDate}){
  const y=month.getFullYear(),m=month.getMonth();
  const first=new Date(y,m,1), start=first.getDay(), days=new Date(y,m+1,0).getDate();
  const cells=[]; for(let i=0;i<start;i++)cells.push(null); for(let d=1;d<=days;d++)cells.push(d);
  while(cells.length%7) cells.push(null);
  const monthLabel=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const monthPrefix=`${y}-${String(m+1).padStart(2,'0')}`;
  const monthTasks=tasks.filter(t=>t.date?.startsWith(monthPrefix)&&!t.completed).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const goToday=()=>{const now=new Date();setMonth(new Date(now.getFullYear(),now.getMonth(),1));};
  return <><PageHead eyebrow="PLAN AHEAD" title="Calendar" subtitle="Click a day to schedule something. Click a task to update it." action={<button className="secondary" onClick={goToday}><CalendarDays size={17}/> Today</button>}/>
    <div className="calendar-shell"><div className="calendar-head"><button className="icon" aria-label="Previous month" onClick={()=>setMonth(new Date(y,m-1,1))}><ChevronLeft/></button><strong>{monthLabel}</strong><button className="icon" aria-label="Next month" onClick={()=>setMonth(new Date(y,m+1,1))}><ChevronRight/></button></div><div className="weekdays">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=><span key={x}>{x}</span>)}</div><div className="calendar-grid">{cells.map((d,i)=>{if(!d)return <div key={i} className="cal-cell blank"/>;const date=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const dayTasks=tasks.filter(t=>t.date===date&&!t.completed).sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));return <div key={i} role="button" tabIndex={0} className={`${date===isoToday()?'cal-cell today':'cal-cell'} ${dayTasks.length?'has-tasks':''}`} onClick={()=>addTaskForDate(date)} onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&e.target===e.currentTarget){e.preventDefault();addTaskForDate(date)}}} aria-label={`Add task on ${new Date(`${date}T12:00:00`).toLocaleDateString()}`}><span className="cal-day-number">{d}</span><div className="cal-task-stack">{dayTasks.slice(0,3).map(t=><button type="button" className="cal-task" key={t.id} onClick={e=>{e.stopPropagation();editTask(t)}}>{t.time&&<small>{t.time}</small>}{t.title}</button>)}{dayTasks.length>3&&<span className="cal-more">+{dayTasks.length-3} more</span>}</div><span className="cal-add-hint"><Plus size={13}/> Add</span></div>})}</div></div>
    <section className="task-section"><div className="section-row"><div><h2>This month</h2><p>Every scheduled task remains editable here.</p></div><span>{monthTasks.length}</span></div><div className="task-list">{monthTasks.length?monthTasks.map(t=><TaskRow key={t.id} task={t} completeTask={completeTask} edit={editTask}/>):<div className="empty-line"><CalendarDays size={18}/>Nothing scheduled this month. Click any day above to add something.</div>}</div></section>
  </>
}

function SearchView({search,setSearch,tasks,notes,completeTask,setEditingTask,setEditingNote,toggleNoteChecklist}){
  const q=search.toLowerCase().trim();
  const taskHits=q?tasks.filter(t=>`${t.title} ${t.note} ${t.category} ${(t.subtasks||[]).map(i=>i.text).join(' ')} ${t.date||''}`.toLowerCase().includes(q)):[];
  const noteHits=q?notes.filter(n=>`${n.title} ${n.body} ${n.label} ${(n.checklist||[]).map(i=>i.text).join(' ')} ${(n.attachments||[]).map(a=>a.name).join(' ')}`.toLowerCase().includes(q)):[];
  return <><PageHead eyebrow="FIND ANYTHING" title="Search" subtitle="The longer you use Daymark, the more useful this becomes."/>
    <div className="search-large"><Search/><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search tasks, notes, labels and details…"/></div>
    {!q?<EmptyState icon={Search} title="Search your memory" text="Try a person, place, account reference, task, idea or keyword."/>:<><TaskSection title="Tasks" tasks={taskHits} completeTask={completeTask} edit={setEditingTask} empty="No matching tasks."/><div className="section-row"><h2>Notes</h2><span>{noteHits.length}</span></div><div className="notes-grid compact">{noteHits.map(n=><NoteCard key={n.id} note={n} onClick={()=>setEditingNote(n)} onToggleChecklist={itemId=>toggleNoteChecklist(n.id,itemId)}/>)}</div></>}
  </>
}

function EmptyState({icon:Icon,title,text,action}){return <div className="empty-state"><div><Icon/></div><h3>{title}</h3><p>{text}</p>{action&&<button className="secondary" onClick={action}><Plus size={17}/> Add something</button>}</div>}
function EmptyCard({title,text}){return <div className="empty-card"><Pin/><strong>{title}</strong><span>{text}</span></div>}

function QuickComposer({quickText,setQuickText,addQuick,onClose,openTask,openNote}){
  const parsed=parseCapture(quickText);
  const [kind,setKind]=useState('task');
  const [date,setDate]=useState(parsed.date||'');
  const [time,setTime]=useState(parsed.time||'');
  const CaptureIcon=kind==='task'?ListTodo:FileText;
  useEffect(()=>{if(parsed.date&&!date)setDate(parsed.date);if(parsed.time&&!time)setTime(parsed.time)},[parsed.date,parsed.time,date,time]);
  const save=()=>addQuick({kind,date:kind==='task'?date:'',time:kind==='task'?time:''});
  return <div className="modal quick-modal"><div className="modal-head"><div><span className="eyebrow">QUICK CAPTURE</span><h2>What do you want to remember?</h2></div><button className="icon" onClick={onClose}><X/></button></div>
    <div className="capture-kind" role="group" aria-label="Capture type"><button className={kind==='task'?'active':''} onClick={()=>setKind('task')}><ListTodo size={15}/> Task</button><button className={kind==='note'?'active':''} onClick={()=>setKind('note')}><FileText size={15}/> Note</button></div>
    <textarea autoFocus value={quickText} onChange={e=>setQuickText(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter')save()}} placeholder="Try: Call Nana tomorrow at 10am\nOr: Remember that the car uses 5W-30 oil"/>
    {kind==='task'&&<div className="quick-schedule"><div className="quick-schedule-head"><CalendarDays size={16}/><strong>Schedule</strong><span>Optional</span></div><div className="quick-schedule-controls"><button type="button" className={date===isoToday()?'active':''} onClick={()=>setDate(isoToday())}>Today</button><button type="button" className={date===addDaysISO(1)?'active':''} onClick={()=>setDate(addDaysISO(1))}>Tomorrow</button><label><span>Date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label><span>Time</span><input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label>{(date||time)&&<button type="button" className="text-btn clear-schedule" onClick={()=>{setDate('');setTime('')}}>Clear</button>}</div></div>}
    {quickText&&<div className="capture-preview"><CaptureIcon size={16}/><span>Saving as a <strong>{kind}</strong>{kind==='task'&&date?` for ${formatDate(date)}`:''}{kind==='task'&&time?` at ${time}`:''}.</span></div>}
    <div className="modal-foot"><div className="mode-links"><button onClick={()=>openTask({title:parsed.title,date,time,list:taskListForDate(date)})}><ListTodo size={16}/> Detailed task</button><button onClick={openNote}><FileText size={16}/> Detailed note</button></div><button className="primary" onClick={save} disabled={!quickText.trim()}>Save {kind}</button></div></div>
}

function TaskEditor({task,defaults={},onSave,onClose,collaboration}){
  const isEditing=Boolean(task?.id);
  const [v,setV]=useState(()=>({...{title:'',completed:false,date:'',time:'',priority:'medium',category:'Personal',list:'inbox',repeat:'none',reminder:'None',note:'',subtasks:[],source:{type:'manual'}},...defaults,...(task||{})}));
  const [reminderStatus,setReminderStatus]=useState('');
  const [assigneeId,setAssigneeId]=useState('');
  const [inviteEmail,setInviteEmail]=useState('');
  const [saving,setSaving]=useState(false), [saveError,setSaveError]=useState('');
  const savingRef=useRef(false);
  const save=async()=>{if(savingRef.current)return;savingRef.current=true;setSaving(true);setSaveError('');try{await onSave(v,assigneeId,inviteEmail.trim(),setV)}catch(err){setSaveError(err.message)}finally{savingRef.current=false;setSaving(false)}};
  const set=(k,val)=>setV(x=>({...x,[k]:val}));
  const setReminder=async value=>{set('reminder',value);if(value==='None')return;if(!('Notification' in window)){setReminderStatus('Browser notifications are not supported on this device.');return;}if(Notification.permission==='default'){const permission=await Notification.requestPermission();setReminderStatus(permission==='granted'?'Browser reminders are enabled.':'Notifications were not allowed. You can change this in browser settings.');}else if(Notification.permission==='denied'){setReminderStatus('Notifications are blocked in browser settings.');}else{setReminderStatus('Browser reminders are enabled.');}};
  return <div className="modal editor-modal" role="dialog" aria-modal="true" aria-labelledby="task-editor-title"><div className="modal-head"><div><span className="eyebrow">{isEditing?'EDIT TASK':'NEW TASK'}</span><h2 id="task-editor-title">{isEditing?'Keep it useful.':'What needs doing?'}</h2></div><button className="icon" aria-label="Close task editor" onClick={onClose}><X/></button></div><div className="form"><label>Task<input autoFocus value={v.title} onChange={e=>set('title',e.target.value)} placeholder="e.g. Renew car insurance"/></label><div className="form-row"><label>Date<input type="date" value={v.date} onChange={e=>{const date=e.target.value;setV(x=>({...x,date,list:taskListForDate(date,x.list)}))}}/></label><label>Time<input type="time" value={v.time} onChange={e=>set('time',e.target.value)}/></label></div><div className="form-row"><label>List<select value={v.list} onChange={e=>{const list=e.target.value;setV(x=>({...x,list,date:list==='today'&&!x.date?isoToday():x.date}))}}><option value="inbox">Inbox</option><option value="today">Today</option><option value="upcoming">Upcoming</option><option value="later">Later</option></select></label><label>Priority<select value={v.priority} onChange={e=>set('priority',e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div><div className="form-row"><label>Category<select value={v.category} onChange={e=>set('category',e.target.value)}>{CATEGORIES.map(c=><option key={c.name}>{c.name}</option>)}</select></label><label>Repeat<select value={v.repeat} onChange={e=>set('repeat',e.target.value)}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label></div><label>Reminder<select value={v.reminder} onChange={e=>setReminder(e.target.value)}><option>None</option><option>At time</option><option>10 minutes before</option><option>30 minutes before</option><option>1 hour before</option><option>1 day before</option><option>Keep reminding until completed</option></select><small className="field-help">{reminderStatus||'Browser reminders work while Daymark is running. Installed/native background reminders require platform scheduling.'}</small></label><label>Short note<textarea value={v.note} onChange={e=>set('note',e.target.value)} placeholder="Optional context…"/></label><SubtaskEditor items={v.subtasks} setItems={items=>set('subtasks',items)}/><AssignmentPicker c={collaboration} taskId={v.id} value={assigneeId} onChange={setAssigneeId} inviteEmail={inviteEmail} onInviteEmail={setInviteEmail} disabled={saving}/>{v.id && <TaskCollaboration c={collaboration} taskId={v.id}/>}<p className="field-help">Assigned people can see the task title, schedule, note and subtasks.</p>{saveError&&<p className="inline-error" role="alert">{saveError}</p>}</div><div className="modal-foot"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!v.title.trim() || saving || ((assigneeId || inviteEmail.trim()) && !collaboration.available)} onClick={save}>{saving?'Saving…':'Save task'}</button></div></div>
}

function SubtaskEditor({items,setItems}){
  const [text,setText]=useState(''); const inputRef=useRef(null);
  const add=()=>{const value=text.trim();if(!value){inputRef.current?.focus();return;}setItems([...items,{id:crypto.randomUUID(),text:value,done:false}]);setText('');requestAnimationFrame(()=>inputRef.current?.focus());};
  return <div className="subtasks"><span>Subtasks</span>{items.map(i=><div key={i.id}><button type="button" className="check mini" onClick={()=>setItems(items.map(x=>x.id===i.id?{...x,done:!x.done}:x))}>{i.done&&<Check size={12}/>}</button><input value={i.text} onChange={e=>setItems(items.map(x=>x.id===i.id?{...x,text:e.target.value}:x))}/><button type="button" className="icon tiny" aria-label="Remove subtask" onClick={()=>setItems(items.filter(x=>x.id!==i.id))}><X size={14}/></button></div>)}<div className="subtask-add-row"><input ref={inputRef} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add()}}} placeholder="Add a subtask"/><button type="button" className="add-item-btn" onClick={add}><Plus size={15}/> Add</button></div></div>
}

function NoteEditor({note,onSave,onDelete,onClose}){
  const blank={title:'',body:'',type:'text',pinned:false,archived:false,label:'Personal',color:'plain',checklist:[],attachments:[],source:{type:'manual'}};
  const [v,setV]=useState(()=>({
    ...blank,
    ...(note||{}),
    attachments:(note?.attachments||[]).map((a,i)=>({id:a.id||`${Date.now()}-${i}`,size:a.size||0,kind:a.kind||(a.type?.startsWith('image/')?'image':a.type?.startsWith('audio/')?'audio':'file'),...a})),
    source:note?.source||{type:'manual'}
  }));
  const [item,setItem]=useState('');
  const [recording,setRecording]=useState(false);
  const [recordSeconds,setRecordSeconds]=useState(0);
  const [voiceError,setVoiceError]=useState('');
  const [attachmentError,setAttachmentError]=useState('');
  const fileRef=useRef(null);
  const itemRef=useRef(null);
  const mediaRecorderRef=useRef(null);
  const mediaStreamRef=useRef(null);
  const chunksRef=useRef([]);
  const recordingStartedRef=useRef(0);
  const set=(k,val)=>setV(prev=>({...prev,[k]:val}));

  useEffect(()=>{
    if(!recording)return;
    const timer=setInterval(()=>setRecordSeconds(s=>s+1),1000);
    return()=>clearInterval(timer);
  },[recording]);

  useEffect(()=>()=>{
    if(mediaRecorderRef.current?.state==='recording') mediaRecorderRef.current.stop();
    mediaStreamRef.current?.getTracks().forEach(t=>t.stop());
  },[]);

  const addChecklistItem=()=>{
    const text=item.trim();
    if(!text){itemRef.current?.focus();return;}
    setV(prev=>({...prev,checklist:[...(prev.checklist||[]),{id:crypto.randomUUID(),text,done:false}]}));
    setItem('');
    requestAnimationFrame(()=>itemRef.current?.focus());
  };

  const readFile=(f)=>new Promise(resolve=>{
    const r=new FileReader();
    r.onload=()=>resolve({
      id:`att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name:f.name,
      type:f.type||'application/octet-stream',
      size:f.size||0,
      kind:f.type?.startsWith('image/')?'image':f.type?.startsWith('audio/')?'audio':'file',
      data:r.result
    });
    r.readAsDataURL(f);
  });
  const addFiles=async e=>{
    setAttachmentError('');
    const files=[...(e.target.files||[])];
    if(!files.length)return;
    const existing=(v.attachments||[]).reduce((sum,a)=>sum+(a.size||0),0);
    const incoming=files.reduce((sum,f)=>sum+(f.size||0),0);
    if(files.some(f=>f.size>2*1024*1024) || existing+incoming>3.5*1024*1024){
      setAttachmentError('To keep offline storage reliable, each file must be under 2 MB and attachments in one note under about 3.5 MB.');
      e.target.value=''; return;
    }
    const items=await Promise.all(files.map(readFile));
    setV(prev=>({...prev,attachments:[...(prev.attachments||[]),...items]}));
    e.target.value='';
  };
  const removeAttachment=id=>setV(prev=>({...prev,attachments:(prev.attachments||[]).filter(a=>a.id!==id)}));
  const openAttachment=a=>{if(a?.data)window.open(a.data,'_blank','noopener,noreferrer')};

  const startRecording=async()=>{
    setVoiceError('');
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
      setVoiceError('Voice recording is not supported in this browser.');
      return;
    }
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      mediaStreamRef.current=stream;
      chunksRef.current=[];
      const recorder=new MediaRecorder(stream);
      mediaRecorderRef.current=recorder;
      recorder.ondataavailable=e=>{if(e.data?.size)chunksRef.current.push(e.data)};
      recorder.onstop=()=>{
        const blob=new Blob(chunksRef.current,{type:recorder.mimeType||'audio/webm'});
        const reader=new FileReader();
        const duration=Math.max(1,Math.round((Date.now()-recordingStartedRef.current)/1000));
        reader.onload=()=>{
          const attachment={id:`voice-${Date.now()}`,name:`Voice note ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}.webm`,type:blob.type||'audio/webm',size:blob.size,kind:'audio',data:reader.result,duration};
          setV(prev=>({...prev,attachments:[...(prev.attachments||[]),attachment]}));
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t=>t.stop());
        mediaStreamRef.current=null;
      };
      recordingStartedRef.current=Date.now();
      recorder.start();
      setRecordSeconds(0);
      setRecording(true);
    }catch(err){
      setVoiceError(err?.name==='NotAllowedError'?'Microphone permission was denied. Allow microphone access and try again.':'Could not start voice recording on this device.');
      mediaStreamRef.current?.getTracks().forEach(t=>t.stop());
      mediaStreamRef.current=null;
    }
  };
  const stopRecording=()=>{
    const recorder=mediaRecorderRef.current;
    if(recorder&&recorder.state!=='inactive')recorder.stop();
    setRecording(false);
  };
  const formatSeconds=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  const formatBytes=n=>!n?'':n<1024?`${n} B`:n<1024*1024?`${(n/1024).toFixed(1)} KB`:`${(n/1024/1024).toFixed(1)} MB`;

  return <div className="modal editor-modal"><div className="modal-head"><div><span className="eyebrow">{note?'EDIT NOTE':'NEW NOTE'}</span><h2>Save it before it slips away.</h2></div><button className="icon" onClick={onClose}><X/></button></div>
    <div className="note-toolbar"><button className={v.type==='text'?'active':''} onClick={()=>set('type','text')}><FileText size={16}/> Text</button><button className={v.type==='checklist'?'active':''} onClick={()=>set('type','checklist')}><ListTodo size={16}/> Checklist</button></div>
    <div className="form"><label>Title<input autoFocus value={v.title} onChange={e=>set('title',e.target.value)} placeholder="A useful title"/></label>
      {v.type==='text'?<label>Note<textarea className="note-body" value={v.body} onChange={e=>set('body',e.target.value)} placeholder="Type anything worth keeping…"/></label>:
      <div className="checklist-editor">{v.checklist.map(i=><div key={i.id}><button type="button" className="check mini" onClick={()=>set('checklist',v.checklist.map(x=>x.id===i.id?{...x,done:!x.done}:x))}>{i.done&&<Check size={12}/>}</button><input value={i.text} onChange={e=>set('checklist',v.checklist.map(x=>x.id===i.id?{...x,text:e.target.value}:x))}/><button type="button" className="icon tiny" title="Remove item" onClick={()=>set('checklist',v.checklist.filter(x=>x.id!==i.id))}><X size={14}/></button></div>)}
        <div className="checklist-add-row"><input ref={itemRef} value={item} onChange={e=>setItem(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addChecklistItem()}}} placeholder="Add a checklist item"/><button type="button" className="add-item-btn" onClick={addChecklistItem}><Plus size={16}/> Add item</button></div>
      </div>}

      <div className="attachment-actions"><button type="button" className="secondary" onClick={()=>fileRef.current?.click()}><Paperclip size={16}/> Attach</button><button type="button" className={recording?'secondary recording-btn':'secondary'} onClick={recording?stopRecording:startRecording}>{recording?<><Square size={15}/> Stop {formatSeconds(recordSeconds)}</>:<><Mic size={16}/> Record voice</>}</button><input ref={fileRef} hidden type="file" multiple accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,audio/*" onChange={addFiles}/></div>
      {voiceError&&<div className="inline-error">{voiceError}</div>}{attachmentError&&<div className="inline-error">{attachmentError}</div>}

      {(v.attachments||[]).length>0&&<div className="attachment-list">{v.attachments.map(a=><div className="attachment-card" key={a.id}>
        {a.kind==='image'?<button type="button" className="attachment-thumb" onClick={()=>openAttachment(a)} title="Preview image"><img src={a.data} alt={a.name}/></button>:a.kind==='audio'?<div className="attachment-icon"><Mic size={18}/></div>:<div className="attachment-icon"><File size={18}/></div>}
        <div className="attachment-meta"><strong>{a.name}</strong><span>{formatBytes(a.size)}{a.duration?` · ${formatSeconds(a.duration)}`:''}</span>{a.kind==='audio'?<audio controls src={a.data}/>:null}</div>
        {a.kind!=='audio'&&<button type="button" className="attachment-open" onClick={()=>openAttachment(a)}>{a.kind==='image'?<ImageIcon size={15}/>:<Play size={15}/>} {a.kind==='image'?'View':'Open'}</button>}
        <button type="button" className="icon tiny attachment-remove" title="Remove attachment" onClick={()=>removeAttachment(a.id)}><X size={15}/></button>
      </div>)}</div>}

      <div className="form-row"><label>Label<select value={v.label} onChange={e=>set('label',e.target.value)}>{CATEGORIES.map(c=><option key={c.name}>{c.name}</option>)}</select></label><label>Color<select value={v.color} onChange={e=>set('color',e.target.value)}><option value="plain">Plain</option><option value="mint">Mint</option><option value="sand">Sand</option><option value="blue">Blue</option><option value="rose">Rose</option></select></label></div>
      <label className="switch-row"><input type="checkbox" checked={v.pinned} onChange={e=>set('pinned',e.target.checked)}/><span><Pin size={16}/> Pin this note</span></label>
    </div>
    <div className="modal-foot note-editor-foot">{note?<button className="danger-text" onClick={()=>{if(window.confirm('Delete this note? This cannot be undone.')){onDelete?.(note.id);onClose();}}}>Delete note</button>:<span/>}<div className="foot-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!v.title.trim()&&!v.body.trim()&&!v.checklist.length&&!(v.attachments||[]).length} onClick={()=>onSave(v)}>Save note</button></div></div>
  </div>
}

function AppLoading(){return <div className="auth-shell"><div className="auth-card loading-card"><div className="brand-mark large"><CheckCircle2 size={28}/></div><h1>Daymark</h1><p>Opening your workspace…</p><RefreshCw className="spin" size={22}/></div></div>}

function ConfigError(){return <div className="auth-shell"><div className="auth-card"><div className="brand-mark large"><CheckCircle2 size={28}/></div><h1>Daymark needs its cloud connection</h1><p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to the environment, then restart Daymark.</p></div></div>}

function AuthScreen({signIn,signUp,requestPasswordReset}){
  const [mode,setMode]=useState('signin');
  const [name,setName]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [message,setMessage]=useState('');
  const submit=async e=>{e.preventDefault();setBusy(true);setError('');setMessage('');try{const result=mode==='signin'?await signIn(email.trim(),password):await signUp(email.trim(),password,name);const {data,error}=result;if(error)throw error;if(mode==='signup'&&!data?.session)setMessage('Account created. Check your email to confirm your address, then sign in.');}catch(err){setError(err?.message||'Could not continue. Please try again.');}finally{setBusy(false)}};
  const resetPassword=async()=>{setBusy(true);setError('');setMessage('');try{await requestPasswordReset(email);setMessage('Check your email for a secure link to set your Daymark password.');}catch(err){setError(err?.message||'Could not send the password email.');}finally{setBusy(false)}};
  return <div className="auth-shell"><div className="auth-panel"><div className="auth-brand"><div className="brand-mark large"><CheckCircle2 size={28}/></div><div><strong>Daymark</strong><span>Tasks & notes</span></div></div><div className="auth-copy"><span className="eyebrow">YOUR DAY, EVERYWHERE</span><h1>Remember what matters. Pick up where you left off.</h1><p>Sign in to keep tasks, notes and attachments synced across web, Android and iPhone while Daymark remains usable when your connection drops.</p><div className="auth-benefits"><span><Cloud size={17}/> Cross-device sync</span><span><LockKeyhole size={17}/> Private by account</span><span><WifiOff size={17}/> Offline-friendly</span></div></div></div><form className="auth-card" onSubmit={submit}><span className="eyebrow">{mode==='signin'?'WELCOME BACK':'CREATE ACCOUNT'}</span><h2>{mode==='signin'?'Sign in to Daymark':'Start using Daymark'}</h2><p>{mode==='signin'?'Your local Daymark data will be safely merged into your account after sign-in.':'Use the same account on every device.'}</p>{mode==='signup'&&<label>Full name<div className="input-with-icon"><Users size={17}/><input type="text" autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/></div></label>}<label>Email<div className="input-with-icon"><Mail size={17}/><input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></div></label><label>Password<div className="input-with-icon"><LockKeyhole size={17}/><input type="password" autoComplete={mode==='signin'?'current-password':'new-password'} required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></div></label>{error&&<div className="inline-error">{error}</div>}{message&&<div className="inline-success">{message}</div>}<button className="primary auth-submit" disabled={busy}>{busy?<><RefreshCw className="spin" size={17}/> Please wait…</>:mode==='signin'?'Sign in':'Create account'}</button>{mode==='signin'&&<button type="button" className="auth-switch" disabled={busy} onClick={resetPassword}>Forgot or never created a password?</button>}<button type="button" className="auth-switch" onClick={()=>{setMode(mode==='signin'?'signup':'signin');setError('');setMessage('')}}>{mode==='signin'?'New to Daymark? Create an account':'Already have an account? Sign in'}</button></form></div>
}

function PasswordSetupGate({email,updatePassword,onComplete}){
  const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submit=async event=>{event.preventDefault();setError('');if(password.length<8){setError('Use at least 8 characters.');return;}if(password!==confirm){setError('The passwords do not match.');return;}setBusy(true);try{await updatePassword(password);onComplete();}catch(err){setError(err?.message||'Could not create your password. Try again.');}finally{setBusy(false)}};
  return <div className="password-setup-gate"><form className="password-setup-card" role="dialog" aria-modal="true" aria-labelledby="password-setup-title" onSubmit={submit}><div className="brand-mark large"><LockKeyhole size={24}/></div><span className="eyebrow">SECURE YOUR ACCOUNT</span><h2 id="password-setup-title">Create your Daymark password</h2><p>Your invitation has been accepted. Create a password so you can return to your dashboard from any device.</p><label>Email<input type="email" value={email||''} readOnly/></label><label>New password<input autoFocus type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event=>setPassword(event.target.value)} placeholder="At least 8 characters"/></label><label>Confirm password<input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={event=>setConfirm(event.target.value)} placeholder="Enter it again"/></label>{error&&<div className="inline-error" role="alert">{error}</div>}<button className="primary" disabled={busy||password.length<8||password!==confirm}>{busy?'Creating password…':'Create password and open Daymark'}</button><small>You will use this email and password whenever you return.</small></form></div>
}

function CloudStatus({cloud}){
  const offline=typeof navigator!=='undefined'&&!navigator.onLine;
  const text=offline?'Offline — changes will sync later':cloud.syncState==='syncing'?'Syncing…':cloud.syncState==='error'?'Saved locally — sync needs attention':'Synced';
  const Icon=offline?WifiOff:cloud.syncState==='syncing'?RefreshCw:Cloud;
  return <button className={`cloud-status ${cloud.syncState}`} onClick={()=>cloud.syncNow()} title={cloud.syncError||'Click to sync now'}><Icon className={cloud.syncState==='syncing'?'spin':''} size={16}/><span>{text}</span></button>
}
