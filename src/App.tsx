import { useEffect, useState, FormEvent, ChangeEvent } from 'react';
import { ShieldAlert, Info, Phone, MessageSquare, ExternalLink, Scale, OctagonAlert, Globe, Settings, Plus, Trash2, Edit2, X, Save, AlertTriangle, Search, Loader2, Upload, ChevronDown, MessageCircle, LogOut, Database, RefreshCw, CheckCircle2, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, getDb, updateFirestoreDatabase, storage } from './lib/firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signOut,
  User
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, Timestamp, writeBatch, getDocFromServer, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, uploadString } from 'firebase/storage';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ISPInfo {
  id?: string;
  asn?: string;
  name: string;
  logo: string;
  ips: string[];
  isDefault?: boolean;
  activationType: 'default' | 'indefinite' | 'monthly';
  status: 'active' | 'suspended';
  expiresAt?: string;
}

interface ProtectedFile {
  id: string;
  title: string;
  content: string;
}

interface DetectionResponse {
  clientIp: string;
  isp: ISPInfo;
}

const DEFAULT_LOGO = "/src/assets/images/regenerated_image_1778619913454.png";

export default function App() {
  const [data, setData] = useState<DetectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [dbStatus, setDbStatus] = useState<{
    firestore: boolean, 
    mode: string, 
    projectId?: string,
    databaseId?: string,
    error?: string | null,
    serviceAccount?: string,
    fallbackWorked?: boolean,
    configuredDatabaseId?: string,
    env?: any
  } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const checkDbStatus = async () => {
    setCheckingStatus(true);
    try {
      const response = await fetch('/api/admin/status');
      const status = await response.json();
      setDbStatus(status);
      
      // Update client-side firestore database if it differs from current status
      if (status.databaseId) {
        updateFirestoreDatabase(status.databaseId);
      }
    } catch (err) {
      console.error("Error fetching detailed DB status:", err);
      // Fallback to basic frontend check
      try {
        await getDocFromServer(doc(getDb(), 'test', 'connection'));
        setDbStatus({ firestore: true, mode: 'cloud' });
      } catch (e: any) {
        setDbStatus({ firestore: false, mode: 'local', error: e.message });
      }
    } finally {
      setCheckingStatus(false);
    }
  };

  useEffect(() => {
    checkDbStatus();
  }, []);

  const fetchData = (retries = 3) => {
    setLoading(true);
    fetch('/api/detect-isp')
      .then(res => {
        if (!res.ok) throw new Error("Server not ready");
        return res.json();
      })
      .then(json => {
        setData(json);
        setLoading(false);
      })
      .catch(err => {
        if (retries > 0) {
          setTimeout(() => fetchData(retries - 1), 1500);
        } else {
          console.error('Error detecting ISP:', err);
          setLoading(false);
        }
      });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const logoUrl = data?.isp?.logo || DEFAULT_LOGO;
    let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = logoUrl;
    
    // Update title as well for better branding
    if (data?.isp?.name) {
      document.title = `${data.isp.name} - Portal de Seguridad`;
    } else {
      document.title = "TICCOL SAS - Portal de Seguridad";
    }
  }, [data]);

  if (loading && !showAdmin && !showDocuments) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-white font-medium animate-pulse">Detectando red del operador...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {showDocuments ? (
        <DocumentsView detectionData={data} databaseId={dbStatus?.databaseId} onBack={() => setShowDocuments(false)} />
      ) : showAdmin ? (
        !user ? (
          <LoginPanel onBack={() => setShowAdmin(false)} />
        ) : (
          <AdminPanel 
            user={user}
            dbStatus={dbStatus} 
            setDbStatus={setDbStatus} 
            checkDbStatus={checkDbStatus}
            checkingStatus={checkingStatus}
            onBack={() => { setShowAdmin(false); fetchData(); }} 
            onLogout={() => { signOut(auth); setShowAdmin(false); }} 
          />
        )
      ) : (
        <BlockerView 
          data={data} 
          dbStatus={dbStatus} 
          onOpenAdmin={() => setShowAdmin(true)} 
          onOpenDocuments={() => setShowDocuments(true)} 
        />
      )}
    </div>
  );
}

function DocumentsView({ detectionData, databaseId, onBack }: { detectionData: DetectionResponse | null, databaseId?: string, onBack: () => void }) {
  const [files, setFiles] = useState<ProtectedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (detectionData?.isp && detectionData.isp.status === 'active') {
      // Fetch initial data from server
      fetch('/api/admin/settings')
        .then(res => res.json())
        .then(config => {
            setFiles(config.protectedFiles || []);
            setLoading(false);
        }).catch(() => {});

      // Fetch documents from Firestore
      const unsubscribe = onSnapshot(doc(getDb(), 'settings', 'global'), (snapshot) => {
        if (snapshot.exists()) {
          const configData = snapshot.data();
          setFiles(prev => {
             const newFiles = configData.protectedFiles || [];
             if (prev && prev.length > 0) {
                 return newFiles.map((f: any) => {
                     const prevF = prev.find((pf: any) => pf.id === f.id);
                     return { ...f, content: prevF?.content || f.content || '' };
                 });
             }
             return newFiles;
          });
          setLoading(false);
        }
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, 'settings/global');
        setError('Error al cargar documentos');
        setLoading(false);
      });
      return () => unsubscribe();
    } else {
      setError('Documentación restringida. Su red no se encuentra autorizada.');
      setLoading(false);
    }
  }, [detectionData, databaseId]);

  const toggleExpand = (id: string) => {
    setExpandedFiles(prev => ({ ...prev, [id]: !prev[id] }));
  };

  function FileContent({ fileId }: { fileId: string }) {
    const file = files.find(f => f.id === fileId);
    if (!file?.content) return <div className="p-4 bg-slate-50 text-slate-400 rounded-2xl border border-dashed border-slate-200 text-xs italic">Sin contenido registrado.</div>;
    return (
      <pre className="whitespace-pre-wrap font-mono text-sm text-slate-700 bg-slate-50 p-6 rounded-2xl border border-dashed border-slate-200 leading-relaxed">
        {file.content}
      </pre>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
       <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-xl">
            <Scale className="w-6 h-6 text-blue-600" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900 italic tracking-tight">Documentación Autorizada</h1>
        </div>
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <X className="w-5 h-5 text-slate-400" />
        </button>
      </header>

      <main className="flex-1 p-6 md:p-10 max-w-4xl mx-auto w-full">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="font-medium italic">Consultando documentos...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-100 text-red-600 p-8 rounded-3xl text-center">
            <OctagonAlert className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <h2 className="text-xl font-bold mb-2">Acceso Denegado</h2>
            <p className="font-medium italic">{error}</p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="bg-blue-600 text-white p-8 rounded-3xl shadow-xl shadow-blue-100 relative overflow-hidden">
              <div className="relative z-10">
                <h2 className="text-2xl font-black italic mb-2 tracking-tight">Zona de Lectura Segura</h2>
                <p className="text-blue-100 font-medium">Contenido accesible únicamente desde infraestructuras autorizadas.</p>
              </div>
              <div className="absolute top-0 right-0 p-8 opacity-20">
                <ShieldAlert size={120} />
              </div>
            </div>

            {files.map(file => {
              const isExpanded = expandedFiles[file.id];
              return (
                <div key={file.id} className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden transition-all">
                  <div className="px-8 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(file.id)}>
                    <div className="flex items-center gap-3">
                      <Save className="w-5 h-5 text-slate-400" />
                      <span className="text-sm font-black text-slate-900 italic uppercase tracking-wider">{file.title}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="px-3 py-1 bg-white border border-slate-200 rounded-full">
                         <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TXT FILE</span>
                      </div>
                      <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  
                  <div className="p-8 space-y-6">
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <FileContent fileId={file.id} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    
                    {!isExpanded && (
                      <button                
                        onClick={async () => {
                            toggleExpand(file.id);
                        }}
                        className="w-full py-2 text-xs font-bold text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                      >
                        Click para ver contenido completo
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function LoginPanel({ onBack }: { onBack: () => void }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-900">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md border border-slate-200"
      >
        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-100 p-3 border border-slate-100">
            <img src={DEFAULT_LOGO} alt="TICCOL SAS" className="max-w-full max-h-full object-contain" />
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-extrabold text-slate-900">Acceso Administrativo</h2>
            <p className="text-sm text-slate-500 font-medium mt-1 uppercase tracking-widest">Portal de Seguridad</p>
          </div>
        </div>

        <div className="space-y-5">
          <button 
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full bg-white border border-slate-200 text-slate-700 font-bold py-4 rounded-2xl hover:bg-slate-50 shadow-sm transition-all flex items-center justify-center gap-3"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            {loading ? "Iniciando..." : "Continuar con Google"}
          </button>
          
          {error && (
            <p className="text-xs font-bold text-red-500 bg-red-50 p-3 rounded-lg border border-red-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </p>
          )}

          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-100"></span>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-slate-400 font-bold tracking-widest">Acceso Restringido</span>
            </div>
          </div>
        </div>

        <button 
          onClick={onBack}
          className="w-full mt-4 text-slate-400 hover:text-slate-600 text-sm font-bold transition-colors"
        >
          Volver al Portal
        </button>
      </motion.div>
    </div>
  );
}

function BlockerView({ 
  data, 
  dbStatus, 
  onOpenAdmin, 
  onOpenDocuments 
}: { 
  data: DetectionResponse | null, 
  dbStatus: any, 
  onOpenAdmin: () => void, 
  onOpenDocuments: () => void 
}) {
  const [logoError, setLogoError] = useState(false);
  
  const isp = data?.isp || {
    name: "TICCOL SAS",
    logo: DEFAULT_LOGO,
    isDefault: true
  };

  return (
    <>
      {/* Header */}
      {/* DB Connection Alert Overlay */}
      <AnimatePresence>
        {dbStatus && !dbStatus.firestore && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }} 
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-red-600 text-white overflow-hidden relative z-50 shadow-lg"
          >
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-4 h-4 text-white animate-pulse" />
                <p className="text-[11px] font-black tracking-tight leading-none uppercase italic">
                  Modo de Emergencia: Firestore Cloud Desconectado
                </p>
                <div className="h-4 w-[1px] bg-white/20 hidden sm:block"></div>
                <p className="text-[10px] font-bold opacity-80 leading-tight hidden sm:block">
                  Los cambios no se guardarán permanentemente hasta restablecer la conexión.
                </p>
              </div>
              <button 
                onClick={onOpenAdmin}
                className="bg-white/10 hover:bg-white/20 text-white px-4 py-1.5 rounded-full font-black text-[9px] uppercase tracking-wider transition-all border border-white/20"
              >
                Diagnosticar Conexión
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="bg-white border-b border-slate-100 px-6 md:px-12 py-5 flex flex-col md:flex-row justify-between items-center gap-6 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-5">
            <div className="h-16 w-32 bg-slate-50 rounded-3xl flex items-center justify-center p-3 border border-slate-100 shadow-sm">
              {!logoError && isp.logo ? (
                <img 
                  src={isp.logo} 
                  alt={isp.name} 
                  className="max-h-full max-w-full object-contain" 
                  onError={() => setLogoError(true)}
                />
              ) : (
                <div className="bg-slate-900 text-white px-4 py-2 rounded-xl font-black italic tracking-tighter text-lg">
                  TICCOL<span className="text-blue-500">.</span>
                </div>
              )}
            </div>
          </div>

          <div className="h-10 w-px bg-slate-200 hidden lg:block"></div>
          
          <div className="flex flex-col">
            <h1 className="text-xl font-extrabold text-slate-900 leading-none mb-1">Portal de Seguridad</h1>
            <p className="text-[10px] md:text-[11px] text-slate-500 uppercase tracking-tight font-bold max-w-md">
              {isp.name} - OPERADOR DE SERVICIOS
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 lg:gap-6">
          <div className="flex flex-col items-center">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter mb-1">DIRECCIÓN IP DETECTADA</p>
            <div className="text-sm font-mono font-bold text-slate-600 bg-slate-50 px-4 py-1.5 rounded-xl border border-slate-100 shadow-inner">
              {data?.clientIp || "207.230.10.248"}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {!isp.isDefault && (
              <button 
                onClick={onOpenDocuments}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-blue-700 transition-all shadow-xl shadow-blue-200"
              >
                <Save className="w-4 h-4" /> Documentos
              </button>
            )}
            <button 
              onClick={onOpenAdmin}
              className="p-2.5 text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 border border-slate-100 rounded-xl hover:shadow-md"
              title="Administrar ISP"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 md:px-20 py-16 text-center max-w-7xl mx-auto w-full">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-10 relative"
        >
          <div className="absolute inset-0 bg-red-500/10 blur-3xl rounded-full scale-150"></div>
          <div className="relative w-28 h-28 bg-white rounded-full flex items-center justify-center shadow-2xl shadow-red-200 border border-red-50 overflow-hidden">
            <AlertTriangle className="h-14 w-14 text-red-500" />
          </div>
        </motion.div>

        <motion.h2 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-5xl md:text-6xl font-black text-slate-900 mb-8 tracking-tighter"
        >
          ACCESO RESTRINGIDO
        </motion.h2>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-xl md:text-2xl text-slate-600 max-w-4xl leading-relaxed font-semibold mb-20"
        >
          Este sitio web ha sido bloqueado en cumplimiento estricto de la <span className="font-black text-blue-600 underline decoration-blue-200 decoration-4 underline-offset-8 text-nowrap">Ley 679 de 2001</span>, el <span className="font-black text-blue-600 underline decoration-blue-200 decoration-4 underline-offset-8 text-nowrap">Decreto 1524 de 2002</span> y la <span className="font-black text-blue-600 underline decoration-blue-200 decoration-4 underline-offset-8 text-nowrap">Ley 1336 de 2009</span>. Estas normas prohíben y sancionan toda actividad que atente contra la integridad de menores en línea. La protección infantil es una responsabilidad compartida que requiere del uso de mecanismos de filtrado y la acción inmediata ante contenidos ilícitos.
        </motion.p>

        {/* Info Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 w-full mb-20">
          {[
            {
              icon: <Scale className="w-8 h-8 text-blue-500" />,
              bg: 'bg-blue-50',
              title: "Fundamento Legal",
              desc: "Normas vigentes para prevenir y contrarrestar la explotación, la pornografía y el turismo sexual con niños, niñas y adolescentes en Colombia."
            },
            {
              icon: <MessageSquare className="w-8 h-8 text-emerald-500" />,
              bg: 'bg-emerald-50 text-emerald-500',
              title: "Cómo Denunciar",
              desc: "Utilice canales oficiales como 'Te Protejo', el Centro Cibernético de la Policía Nacional para reportar cualquier sospecha de explotación infantil."
            },
            {
              icon: <ShieldAlert className="w-8 h-8 text-amber-500" />,
              bg: 'bg-amber-50',
              title: "Mecanismos de Filtrado",
              desc: "Implemente software de control parental, listas de bloqueo y navegación segura para proteger a los menores de contenidos inapropiados o peligrosos."
            },
            {
              icon: <AlertTriangle className="w-8 h-8 text-red-500" />,
              bg: 'bg-red-50',
              title: "Entes de Control",
              desc: "El Ministerio TIC, la SIC y la CRC supervisan la legalidad del contenido en internet y actúan sobre las denuncias recibidas para garantizar un entorno seguro."
            }
          ].map((item, index) => (
            <motion.div 
              key={index}
              className={`${item.bg} p-8 rounded-3xl flex flex-col items-center text-center`}
            >
              <div className="mb-6 bg-white p-4 rounded-full shadow-sm">{item.icon}</div>
              <h3 className="text-xl font-black text-slate-900 mb-3">{item.title}</h3>
              <p className="text-slate-600 leading-relaxed font-medium">{item.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Canales de Denuncia Section */}
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="w-full bg-white rounded-3xl p-10 shadow-lg border border-slate-100 mb-10"
        >
            <h2 className="text-3xl font-black text-slate-900 mb-8 italic">¿Dónde realizar denuncias oficiales?</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { title: "Te Protejo", desc: "Plataforma especializada en la protección de niños, niñas y adolescentes en línea.", link: "https://www.teprotejo.org" },
                    { title: "CAI Virtual (Policía)", desc: "Centro de atención virtual para reportar delitos informáticos ante las autoridades.", link: "https://caivirtual.policia.gov.co" },
                     { title: "Línea 141 (ICBF)", desc: "Línea de atención gratuita para protección y derechos de los menores.", link: "tel:141" }
                ].map((site, index) => (
                  site.link.startsWith('tel:') ? (
                    <a href={site.link} key={index} className="block bg-slate-50 p-6 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50 transition-all group">
                         <h4 className="font-bold text-slate-900 mb-2 group-hover:text-blue-700">{site.title}</h4>
                         <p className="text-slate-600 text-sm">{site.desc}</p>
                    </a>
                  ) : (
                    <a href={site.link} target="_blank" rel="noopener noreferrer" key={index} className="block bg-slate-50 p-6 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50 transition-all group">
                         <h4 className="font-bold text-slate-900 mb-2 group-hover:text-blue-700">{site.title}</h4>
                         <p className="text-slate-600 text-sm">{site.desc}</p>
                    </a>
                  )
                ))}
            </div>
        </motion.div>

        {/* Control Parental Section */}
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="w-full bg-slate-900 rounded-3xl p-10 shadow-2xl border border-slate-800 mb-20"
        >
            <h2 className="text-3xl font-black text-white mb-8 italic">Control Parental: Recomendaciones y Métodos</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-slate-800 p-8 rounded-2xl">
                    <h4 className="text-white font-bold text-xl mb-4">Aplicativos Recomendados</h4>
                    <ul className="text-slate-300 space-y-3 list-disc list-inside">
                        <li><strong>Google Family Link:</strong> Gestión completa de dispositivos Android y vinculación de cuentas.</li>
                        <li><strong>Qustodio:</strong> Filtrado web avanzado, límites de tiempo y control de aplicaciones.</li>
                        <li><strong>Norton Family:</strong> Supervisión de actividades web y bloqueo de sitios inapropiados.</li>
                    </ul>
                </div>
                <div className="bg-slate-800 p-8 rounded-2xl">
                    <h4 className="text-white font-bold text-xl mb-4">Métodos de Protección</h4>
                    <ul className="text-slate-300 space-y-3 list-disc list-inside">
                        <li><strong>SafeSearch:</strong> Activación en buscadores principales (Google, Bing).</li>
                        <li><strong>YouTube Kids:</strong> Entorno controlado y filtrado automático.</li>
                        <li><strong>Educación y Horarios:</strong> Definición de tiempos de uso y supervisión directa.</li>
                    </ul>
                </div>
            </div>
        </motion.div>

        {/* Action Buttons */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col sm:flex-row gap-6 w-full sm:w-auto"
        >
          <a 
            href="https://www.teprotejo.org" 
            target="_blank" 
            rel="noopener noreferrer"
            className="group relative px-10 py-5 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-800 shadow-[0_20px_50px_rgba(15,23,42,0.3)] transition-all flex items-center justify-center gap-3 overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            Reportar en TeProtejo.org <ExternalLink className="w-4 h-4 opacity-50" />
          </a>
          <a 
            href="https://caivirtual.policia.gov.co" 
            target="_blank" 
            rel="noopener noreferrer"
            className="px-10 py-5 bg-white text-slate-700 border border-slate-200 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-50 shadow-[0_20px_40px_rgba(0,0,0,0.05)] transition-all flex items-center justify-center gap-3"
          >
            CAI Virtual - Policía Nacional <ExternalLink className="w-4 h-4 opacity-50" />
          </a>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 p-8 md:p-12">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-12">
            <div className="flex flex-col gap-6 w-full lg:w-auto">
              <div className="text-[10px] font-bold text-slate-400 leading-tight uppercase tracking-[0.2em] text-center lg:text-left">
                Instituciones Vinculadas
              </div>
              <div className="flex flex-wrap justify-center lg:justify-start items-center gap-6 md:gap-10">
                {[
                  { id: 'inst-crc', name: 'CRC', url: 'https://www.crcom.gov.co/', domain: 'crcom.gov.co', logo: 'https://ims.net.co/wp-content/uploads/2025/11/logocrc.webp' },
                  { id: 'inst-mintic', name: 'MinTIC', url: 'https://www.mintic.gov.co/', domain: 'mintic.gov.co', logo: 'https://ims.net.co/wp-content/uploads/2025/11/logoMintic.webp' },
                  { id: 'inst-coljuegos', name: 'Coljuegos', url: 'https://www.coljuegos.gov.co/publicaciones/301841/juegosonline/', domain: 'coljuegos.gov.co', logo: 'https://yt3.googleusercontent.com/ytc/AIdro_lDn_bBMMn_-s_tPq3UOn3SYmkGaEj8e8Ojn-ZPaROZehs=s900-c-k-c0x00ffffff-no-rj' },
                  { id: 'inst-policia', name: 'Policía Nacional', url: 'https://www.policia.gov.co/', domain: 'policia.gov.co' },
                  { id: 'inst-fiscalia', name: 'Fiscalía', url: 'https://www.fiscalia.gov.co/', domain: 'fiscalia.gov.co', logo: 'https://www.fiscalia.gov.co/colombia/wp-content/uploads/LogoFiscalia.jpg' }
                ].map((inst) => (
                  <a 
                    key={inst.name}
                    id={inst.id}
                    href={inst.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-2 group transition-all duration-300"
                  >
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-white rounded-2xl flex items-center justify-center p-2.5 border border-slate-100 group-hover:border-blue-200 group-hover:bg-blue-50 group-hover:shadow-2xl group-hover:shadow-blue-100 transition-all grayscale group-hover:grayscale-0 opacity-60 group-hover:opacity-100 group-hover:-translate-y-1 overflow-hidden">
                      <img 
                        src={(inst as any).logo || `https://www.google.com/s2/favicons?domain=${inst.domain}&sz=128`} 
                        alt={inst.name} 
                        className="w-full h-full object-contain transition-transform group-hover:scale-110"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          if (target.src !== `https://logo.clearbit.com/${inst.domain}`) {
                            target.src = `https://logo.clearbit.com/${inst.domain}`;
                          }
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight group-hover:text-blue-600 transition-colors uppercase">{inst.name}</span>
                  </a>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center lg:items-end gap-3 w-full lg:flex-1">
              <div className="bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 w-full lg:max-w-md relative overflow-hidden">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.4)]"></div>
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-[0.2em]">Hora Legal Colombiana</span>
                </div>
                <div className="bg-white rounded-2xl md:bg-slate-50/50 overflow-hidden border border-slate-100 flex items-center justify-center relative shadow-inner p-1">
                  <iframe 
                    src="https://horalegalnueva.inm.gov.co/widget.html" 
                    width="250px" 
                    height="300px" 
                    scrolling="no" 
                    style={{ border: 'none' }}
                    title="Hora Legal Colombiana"
                  ></iframe>
                </div>
                <div className="mt-4 flex flex-col gap-3">
                  <div className="text-[10px] text-slate-400 text-center font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-blue-500" /> Sincronizada con el Instituto Nacional de Metrología
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center border-t border-slate-100 pt-10 gap-6">
            <div className="flex flex-col md:flex-row items-center gap-4">
              <div className="text-[10px] md:text-sm font-bold text-slate-400 text-center md:text-left leading-relaxed">
                © {new Date().getFullYear()} TICCOL SAS<br className="md:hidden" />
                <span className="hidden md:inline"> - </span>
                Portal de Seguridad y Bloqueo de Contenidos.
              </div>
              <a 
                href="https://wa.me/573007081170" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-1.5 bg-[#25D366] hover:bg-[#128C7E] text-white rounded-full text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-100/50 group"
              >
                <MessageCircle className="w-3 h-3 fill-white" /> 
                <span className="group-hover:scale-105 transition-transform">Soporte TICCOL</span>
              </a>
            </div>
            <div className="text-center md:text-right bg-slate-50 px-6 py-3 rounded-full border border-slate-100">
              <p className="text-[9px] font-bold text-slate-400 mb-1 uppercase tracking-[0.2em]">Supervisado por</p>
              <p className="text-sm font-black text-slate-700 uppercase tracking-tight">{isp.name}</p>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}

function AdminPanel({ 
  onBack, 
  onLogout, 
  dbStatus, 
  setDbStatus,
  checkDbStatus,
  checkingStatus,
  user
}: { 
  onBack: () => void, 
  onLogout: () => void, 
  dbStatus: any, 
  setDbStatus: any,
  checkDbStatus: () => Promise<void>,
  checkingStatus: boolean,
  user: User | null
}) {
  const [isps, setIsps] = useState<ISPInfo[]>([]);
  const [activeTab, setActiveTab] = useState<'isps' | 'config' | 'cloud'>('isps');
  const [systemConfig, setSystemConfig] = useState<any>({ defaultName: '', defaultLogo: '', protectedFiles: [] });
  const [loading, setLoading] = useState(true);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [editingIsp, setEditingIsp] = useState<Partial<ISPInfo> | null>(null);
  const [editingConfig, setEditingConfig] = useState(false);
  const [ispToDelete, setIspToDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cloudForm, setCloudForm] = useState({ databaseId: '', serviceAccountKey: '' });
  const [cloudSaving, setCloudSaving] = useState(false);

  const isMasterAdmin = user?.email === 'ticcolcolombia@gmail.com';

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleUpdateCloudConfig = async (e: FormEvent) => {
    e.preventDefault();
    if (!isMasterAdmin) return;
    setCloudSaving(true);
    try {
      console.log("[Admin] Sending cloud configuration update...");
      const res = await fetch('/api/admin/config-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloudForm)
      });
      
      let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        console.error("[Admin] Server returned non-JSON response:", text.substring(0, 500));
        throw new Error(`El servidor respondió con un formato inesperado (${res.status}). Verifique la consola.`);
      }

      if (data.success) {
        showToast("Configuración de nube actualizada correctamente.");
        checkDbStatus();
      } else {
        alert("Error de configuración: " + (data.error || "Desconocido"));
      }
    } catch (err: any) {
      console.error("[Admin] handleUpdateCloudConfig network error:", err);
      alert("Error de comunicación: " + (err.message || "No se pudo contactar con el servidor. Verifique su conexión o reporte el error."));
    } finally {
      setCloudSaving(false);
    }
  };

  useEffect(() => {
    // Initial fetch from server in case Firestore is unavailable
    const fetchFromServer = async () => {
      try {
        const statusRes = await fetch('/api/admin/status');
        if (statusRes.ok) {
          const status = await statusRes.json();
          setDbStatus(status);
        }

        const res = await fetch('/api/admin/isps');
        if (res.ok) {
          const list = await res.json();
          setIsps(list);
        }
        
        const res2 = await fetch('/api/admin/settings');
        if (res2.ok) {
          let config = await res2.json();
          if (!config) config = { defaultName: '', defaultLogo: '', protectedFiles: [] };
          setSystemConfig(config);
        }
      } catch (e) { console.error("Initial fetch failed", e); }
    };
    fetchFromServer();

    const unsubIsps = onSnapshot(collection(getDb(), 'isps'), (snapshot) => {
      const ispList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ISPInfo));
      setIsps(ispList);
      setLoading(false);
    }, (err) => {
      setLoading(false);
      handleFirestoreError(err, OperationType.LIST, 'isps');
    });

    const unsubConfig = onSnapshot(doc(getDb(), 'settings', 'global'), (snapshot) => {
      console.log("Snapshot of settings/global exists:", snapshot.exists());
      if (snapshot.exists()) {
        const configData = snapshot.data();
        setSystemConfig((prev: any) => {
          const newData = { ...configData };
          if (newData.protectedFiles && prev?.protectedFiles) {
             newData.protectedFiles = newData.protectedFiles.map((f: any) => {
                const prevF = prev.protectedFiles.find((pf: any) => pf.id === f.id);
                return { ...f, content: prevF?.content || f.content || '' };
             });
          }
          return newData;
        });
      } else {
        console.warn("Global settings document not found!");
      }
    }, (err) => {
      setLoading(false);
      console.error("Firestore error in onSnapshot(settings/global):", err);
      handleFirestoreError(err, OperationType.GET, 'settings/global');
    });

    return () => {
      unsubIsps();
      unsubConfig();
    };
  }, [dbStatus?.databaseId]);

  const handleResetDefaults = async () => {
    if (confirm('¿Estás seguro de restaurar todos los operadores predeterminados? Se perderán los cambios manuales.')) {
      setLoading(true);
      try {
        const res = await fetch('/api/admin/reset-isps', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Configuración restaurada');
        } else {
          alert("Error: " + data.message);
        }
      } catch (err) {
        alert("Error al restaurar defaults");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleASNLookup = () => {
    if (!editingIsp?.asn) return;
    setLookupLoading(true);
    fetch(`/api/lookup-asn/${editingIsp.asn}`)
      .then(res => res.json())
      .then(data => {
        if (data.name) {
          const newIps = [...(editingIsp.ips || [])];
          data.prefixes.forEach((p: string) => {
            if (!newIps.includes(p)) newIps.push(p);
          });
          
          setEditingIsp({
            ...editingIsp,
            name: (editingIsp.name && editingIsp.name !== '') ? editingIsp.name : data.name,
            ips: newIps
          });
        }
      })
      .catch(err => alert("Error consultando ASN"))
      .finally(() => setLookupLoading(false));
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast("El archivo es demasiado grande (máximo 2MB)"); return; }
    const reader = new FileReader();
    reader.onloadend = () => { setEditingIsp({ ...editingIsp, logo: reader.result as string }); };
    reader.readAsDataURL(file);
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      // First try server (for local file sync)
      const res = await fetch(`/api/admin/isps/${id}`, { method: 'DELETE' });
      const data = await res.json();
      
      // If server failed to sync to firestore, try direct
      if (data.firestore === false) {
        try {
          await deleteDoc(doc(getDb(), 'isps', id));
          showToast('Eliminado en Nube + Local');
        } catch (e) {
          showToast('Eliminado solo en Local (Error IAM)');
        }
      } else {
        showToast('Operador eliminado');
      }

      // Update local state immediately to ensure UI reflects the change
      setIsps(prev => prev.filter(isp => isp.id !== id));

      if (editingIsp?.id === id) setEditingIsp(null);
      setIspToDelete(null);
    } catch (err) {
      showToast('Error de conexión');
      setIspToDelete(null);
    } finally {
      setLoading(false);
    }
  };

  const handleInitialSeed = async () => {
    try {
      setLoading(true);
      showToast('Iniciando sincronización...');
      
      // 1. Try server side first (to reset local file backup)
      const res = await fetch('/api/admin/reset-isps', { method: 'POST' });
      const serverData = await res.json();
      
      // 2. Always try browser-side seeding (works if user is logged in even if server has IAM issues)
      showToast('Sincronizando con la nube...');
      
      const initialIsps = [
        { id: "1", name: "Claro Colombia", logo: "https://upload.wikimedia.org/wikipedia/commons/4/4c/Claro.svg", ips: ["190.157.0.0/16", "186.28.0.0/16", "186.29.0.0/16", "2800:480::/32"], activationType: 'default', status: 'active' },
        { id: "2", name: "Movistar Colombia", logo: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Movistar_logo.svg", ips: ["190.156.0.0/16", "181.137.0.0/16", "200.75.0.0/16", "2800:af::/32"], activationType: 'default', status: 'active' },
        { id: "3", name: "Tigo Colombia", logo: "https://upload.wikimedia.org/wikipedia/commons/3/36/Logo_Tigo.svg", ips: ["181.134.0.0/16", "181.133.0.0/16", "181.129.0.0/16", "2800:1e0::/32"], activationType: 'default', status: 'active' },
        { id: "4", name: "ETB", logo: "https://upload.wikimedia.org/wikipedia/commons/9/9c/Logo_etb.svg", ips: ["181.135.0.0/16", "181.56.0.0/16", "200.21.0.0/16", "2800:40::/32"], activationType: 'default', status: 'active' },
        { id: "5", asn: "273120", name: "TICCOL COLOMBIA S.A.S.", logo: "https://ticcol.com/wp-content/uploads/2021/04/Logo-Ticcol-Colombia-S.A.S.png", ips: [], activationType: 'default', status: 'active' }
      ];

      const batch = writeBatch(getDb());
      initialIsps.forEach(isp => {
        batch.set(doc(getDb(), 'isps', isp.id), {
          ...isp,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        }, { merge: true });
      });
      
      const config = {
        defaultName: "TICCOL SAS",
        defaultLogo: "https://ticcol.com/wp-content/uploads/2021/04/Logo-Ticcol-Colombia-S.A.S.png",
        protectedFiles: [
          { id: "file1", title: "mintic.txt", content: "" },
          { id: "file2", title: "coljuegos.txt", content: "" }
        ],
        updatedAt: Timestamp.now()
      };
      batch.set(doc(getDb(), 'settings', 'global'), config, { merge: true });

      await batch.commit();
      
      // Refresh status from server
      const statusRes = await fetch('/api/admin/status');
      if (statusRes.ok) setDbStatus(await statusRes.json());
      
      showToast('Base de datos sincronizada con éxito');
    } catch (err) {
      console.error(err);
      showToast('Error sincronizando base de datos');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingIsp || lookupLoading) return;

    setLookupLoading(true);
    try {
      const res = await fetch('/api/admin/isps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingIsp)
      });
      const resData = await res.json();
      
      if (res.ok) {
        // If server couldn't write to firestore, try browser-side write
        if (resData.firestore === false) {
          try {
            const dataToSave = {
              ...editingIsp,
              id: editingIsp.id || resData.isp.id,
              updatedAt: Timestamp.now()
            };
            await setDoc(doc(getDb(), 'isps', dataToSave.id), dataToSave, { merge: true });
            showToast('Guardado en Nube + Local');
          } catch (e) {
            showToast('Guardado solo en Local (Error IAM)');
          }
        } else {
          showToast('Operador guardado');
        }
        setEditingIsp(null);
        // FORCE REFRESH FROM SERVER TO SYNC LOCAL CACHE
        setTimeout(() => {
          fetch('/api/admin/isps').then(r => r.json()).then(list => setIsps(list || []));
        }, 500);
      } else {
        showToast('Error al guardar');
      }
    } catch (err) {
      showToast('Error de conexión');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleSaveSystemConfig = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(systemConfig)
      });
      const resData = await res.json();

      if (res.ok) {
        if (resData.firestore === false) {
          try {
            await setDoc(doc(getDb(), 'settings', 'global'), {
              ...systemConfig,
              updatedAt: Timestamp.now()
            }, { merge: true });
            showToast('Configuración Nube + Local');
          } catch (e) {
            showToast('Configuración solo Local (Error IAM)');
          }
        } else {
          showToast('Configuración guardada');
        }
        setEditingConfig(false);
        // FORCE REFRESH FROM SERVER
        setTimeout(() => {
          fetch('/api/admin/settings').then(r => r.json()).then(conf => setSystemConfig(conf || { defaultName: '', defaultLogo: '', protectedFiles: [] }));
        }, 500);
      } else {
        showToast('Error al guardar');
      }
    } catch (err) {
      showToast('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleConfigLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert("El archivo es demasiado grande (máximo 2MB)"); return; }
    const reader = new FileReader();
    reader.onloadend = () => { setSystemConfig({ ...systemConfig, defaultLogo: reader.result as string }); };
    reader.readAsDataURL(file);
  };

  const handleProtectedFileUpload = async (e: ChangeEvent<HTMLInputElement>, fileId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Control de tamaño: 5MB = 5 * 1024 * 1024 bytes
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert('El archivo supera el tamaño máximo permitido de 5MB.');
      return;
    }

    if (file.type !== 'text/plain') { alert('Solo se permiten archivos TXT'); return; }

    setUploading(true);
    try {
      const text = await file.text();
      
      let currentFiles = (systemConfig.protectedFiles || []).map((f: any) => ({
        id: f.id,
        title: f.title,
        content: f.content
      }));
      
      if (currentFiles.length === 0) {
        currentFiles = [
          { id: 'file1', title: 'mintic.txt' },
          { id: 'file2', title: 'coljuegos.txt' }
        ];
      }

      let fileExists = currentFiles.some((f: any) => f.id === fileId);
      let updatedFiles;
      
      if (fileExists) {
        updatedFiles = currentFiles.map((f: any) => f.id === fileId ? { ...f, title: file.name, content: text } : f);
      } else {
        updatedFiles = [...currentFiles, { id: fileId, title: file.name, content: text }];
      }
      
      const newConfig = { ...systemConfig, protectedFiles: updatedFiles };
      
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      
      if (!res.ok) throw new Error("Fallo al guardar en el servidor");
      
      setSystemConfig(newConfig);
      showToast('Archivo guardado exitosamente.');
    } catch (err) {
      console.error("File upload failed:", err);
      alert("Error al procesar el archivo: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  };

    const [fileUrls, setFileUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        const fetchUrls = async () => {
            // Deprecated: We now use subcollections for file content
        };
        fetchUrls();
    }, [systemConfig.protectedFiles]);

  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <Settings className="w-6 h-6 text-slate-400" />
          <h1 className="text-lg font-bold text-slate-900">Configuración - TICCOL SAS</h1>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${dbStatus?.firestore ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            <div className={`w-2 h-2 rounded-full ${dbStatus?.firestore ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
            {dbStatus?.firestore ? 'Firestore Conectado' : 'Firestore Desconectado'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleResetDefaults}
            className="text-sm font-bold text-amber-600 hover:text-amber-700 px-4 py-2 bg-amber-50 rounded-lg transition-colors border border-amber-100 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4" /> Restaurar Defaults
          </button>
          <button 
            onClick={onLogout}
            className="text-sm font-bold text-red-600 hover:text-red-700 px-4 py-2 bg-red-50 rounded-lg transition-colors border border-red-100"
          >
            Cerrar Sesión
          </button>
          <button 
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900 px-4 py-2 bg-slate-100 rounded-lg transition-colors border border-slate-200"
          >
            <X className="w-4 h-4" /> Portal
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-10 max-w-6xl mx-auto w-full">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 mb-8 bg-slate-100 p-1 rounded-2xl w-fit">
          <button 
            onClick={() => setActiveTab('isps')}
            className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${activeTab === 'isps' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Globe className="w-4 h-4" /> Operadores
          </button>
          <button 
            onClick={() => setActiveTab('config')}
            className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${activeTab === 'config' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Settings className="w-4 h-4" /> Identidad
          </button>
          {isMasterAdmin && (
            <button 
              onClick={() => setActiveTab('cloud')}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${activeTab === 'cloud' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Database className="w-4 h-4" /> Nube
            </button>
          )}
        </div>

        {activeTab === 'cloud' && isMasterAdmin && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm relative overflow-hidden">
               <div className="absolute top-0 left-0 w-1 bg-blue-600 h-full"></div>
               <div className="flex items-center gap-4 mb-8">
                 <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center border border-blue-100">
                   <Key className="w-6 h-6 text-blue-600" />
                 </div>
                 <div>
                   <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Configuración de Nube TICCOL</h2>
                   <p className="text-sm text-slate-500 font-medium italic">Acceso exclusivo Maestro. Configura las credenciales críticas del servidor en caliente.</p>
                 </div>
               </div>

               <form onSubmit={handleUpdateCloudConfig} className="space-y-6">
                 <div>
                   <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Database ID</label>
                   <input 
                     className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                     value={cloudForm.databaseId}
                     onChange={e => setCloudForm({...cloudForm, databaseId: e.target.value})}
                     placeholder="(default) o ID de AI Studio..."
                   />
                   <p className="mt-2 text-[10px] text-slate-500 ml-1">Por defecto: (default). Cambie solo si conoce el ID de Firestore exacto.</p>
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Service Account JSON (FIREBASE_SERVICE_ACCOUNT_KEY)</label>
                   <textarea 
                     className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 h-48"
                     value={cloudForm.serviceAccountKey}
                     onChange={e => setCloudForm({...cloudForm, serviceAccountKey: e.target.value})}
                     placeholder='{ "type": "service_account", ... }'
                   />
                   <p className="mt-2 text-[10px] text-slate-500 ml-1">Pegue el contenido completo del archivo JSON de su cuenta de servicio. <strong>CUIDADO:</strong> Esto reemplaza la conexión activa.</p>
                 </div>

                 <div className="flex justify-end pt-4">
                   <button 
                     type="submit"
                     disabled={cloudSaving}
                     className="flex items-center gap-2 bg-blue-600 text-white px-8 py-3 rounded-xl font-bold text-sm hover:translate-y-[-2px] transition-all shadow-lg shadow-blue-200 active:scale-95 disabled:opacity-50"
                   >
                     {cloudSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                     {cloudSaving ? "Conectando..." : "Aplicar y Probar Conexión"}
                   </button>
                 </div>
               </form>
            </div>
            
            <div className="p-6 bg-slate-900 rounded-3xl text-white">
              <h4 className="text-sm font-black italic mb-4 tracking-tight flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" /> RESUMEN TÉCNICO DE INSTANCIA
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4 font-mono text-[11px] opacity-90">
                <div className="space-y-4">
                  <div className="flex justify-between border-b border-white/10 pb-2">
                    <span>STATUS</span>
                    <span className={dbStatus?.firestore ? 'text-emerald-400' : 'text-red-400'}>{dbStatus?.firestore ? 'ONLINE' : 'OFFLINE'}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/10 pb-2">
                    <span>DATABASE_ID</span>
                    <span className="text-blue-300">{dbStatus?.databaseId || '(default)'}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/10 pb-2">
                    <span>PROJECT_ID</span>
                    <span className="text-blue-300 truncate ml-4">{dbStatus?.projectId || '---'}</span>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between border-b border-white/10 pb-2">
                    <span>SA_TYPE</span>
                    <span className="text-blue-300">{dbStatus?.serviceAccountType || '---'}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/10 pb-2">
                    <span>SA_EMAIL</span>
                    <span className="text-blue-300 truncate ml-4">{dbStatus?.serviceAccount || '---'}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/10 pb-2">
                    <span>FALLBACK</span>
                    <span className={dbStatus?.fallbackWorked ? 'text-amber-400' : 'text-slate-500'}>{dbStatus?.fallbackWorked ? 'TRUE' : 'FALSE'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {(activeTab === 'config' || activeTab === 'isps') && dbStatus && (
          <div className={`mb-8 border rounded-2xl p-4 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-500 ${dbStatus.firestore ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-100/50 border-amber-200'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${dbStatus.firestore ? 'bg-emerald-200' : 'bg-amber-200'}`}>
                {dbStatus.firestore ? <CheckCircle2 className="w-5 h-5 text-emerald-700" /> : <AlertTriangle className="w-5 h-5 text-amber-900" />}
              </div>
              <div>
                <p className={`text-sm font-black uppercase tracking-tight ${dbStatus.firestore ? 'text-emerald-900' : 'text-amber-950'}`}>
                  {dbStatus.firestore ? 'Nube Conectada' : 'Modo Local Activo'}
                </p>
                <p className={`text-[11px] font-medium ${dbStatus.firestore ? 'text-emerald-700' : 'text-amber-800'}`}>
                  {dbStatus.firestore 
                    ? `Estado óptimo: Sincronizando con Firestore (${dbStatus.projectId})` 
                    : `Atención: El servidor opera en modo local por falta de permisos Cloud.`}
                </p>
              </div>
            </div>
            <button 
              onClick={checkDbStatus}
              disabled={checkingStatus}
              className={`px-4 py-2 rounded-lg text-[10px] font-black transition-all uppercase tracking-widest flex items-center gap-2 ${dbStatus.firestore ? 'bg-emerald-900 text-white' : 'bg-amber-900 text-white'}`}
            >
              {checkingStatus ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refrescar
            </button>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Global Configuration Section */}
            <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm overflow-hidden relative">
          <div className="absolute top-0 left-0 w-1 bg-blue-600 h-full"></div>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100 p-3 shrink-0">
                <img src={systemConfig.defaultLogo || DEFAULT_LOGO} alt={systemConfig.defaultName || "TICCOL SAS"} className="max-w-full max-h-full object-contain" />
              </div>
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900 leading-tight">Administración Global - TICCOL SAS</h2>
                <p className="text-slate-500 font-medium">Control maestro de operadores y documentos de seguridad.</p>
              </div>
            </div>
            {!editingConfig ? (
              <button 
                onClick={() => setEditingConfig(true)}
                className="flex items-center gap-2 bg-slate-100 text-slate-700 px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all border border-slate-200"
              >
                <Edit2 className="w-4 h-4" /> Editar Identidad Global
              </button>
            ) : (
              <div className="flex gap-2">
                <button 
                  onClick={handleSaveSystemConfig}
                  className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-opacity-90 shadow-lg shadow-blue-100 transition-all"
                >
                  <Save className="w-4 h-4" /> Guardar
                </button>
                <button 
                  onClick={() => { setEditingConfig(false); }}
                  className="bg-white text-slate-600 border border-slate-200 px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-50 transition-all"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          <AnimatePresence>
            {editingConfig && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-8 mt-8 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Nombre por Defecto</label>
                    <input 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                      value={systemConfig.defaultName}
                      onChange={e => setSystemConfig({...systemConfig, defaultName: e.target.value})}
                      placeholder="Ej: TICCOL SAS"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Logo por Defecto</label>
                    <div className="flex gap-2">
                      <input 
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                        value={systemConfig.defaultLogo}
                        onChange={e => setSystemConfig({...systemConfig, defaultLogo: e.target.value})}
                        placeholder="URL de imagen..."
                      />
                      <label className="px-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-center shrink-0">
                        <Upload className="w-4 h-4 text-slate-500" />
                        <input type="file" className="hidden" accept="image/*" onChange={handleConfigLogoUpload} />
                      </label>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Protected Documents Management Section */}
        <div className="bg-white rounded-3xl border border-slate-200 p-8 mb-12 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 bg-amber-500 h-full"></div>
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center border border-amber-100">
              <Save className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Documentos Protegidos (Redes Autorizadas)</h2>
              <p className="text-sm text-slate-500 font-medium italic">Sube archivos TXT que solo serán accesibles desde las redes configuradas.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(systemConfig.protectedFiles?.length ? systemConfig.protectedFiles : [
              { id: 'file1', title: 'mintic.txt' },
              { id: 'file2', title: 'coljuegos.txt' }
            ]).map((file: any) => (
              <div key={file.id} className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex flex-col gap-4">
                <div className="border-b border-slate-100 bg-slate-50/50 flex items-center justify-between pb-4">
                  <div className="flex items-center gap-3">
                    <span className="font-black italic text-slate-900 tracking-tight">{file.title || (file.id === 'file1' ? 'mintic.txt' : 'coljuegos.txt')}</span>
                    <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${file.content ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      {file.content ? (
                        <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(file.content)}`} download={file.title || 'archivo.txt'}>
                          CARGADO (DESCARGAR)
                        </a>
                      ) : (
                        'VACÍO'
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <label className="flex-1 cursor-pointer">
                    <div className="flex items-center justify-center gap-2 bg-white border border-slate-200 p-3 rounded-xl hover:bg-slate-50 transition-all font-bold text-xs text-slate-600">
                      <Upload className="w-4 h-4" /> Subir TXT
                    </div>
                    <input type="file" accept=".txt" className="hidden" onChange={(e) => handleProtectedFileUpload(e, file.id)} />
                  </label>
                  {file.content && (
                    <button 
                      onClick={async () => {
                        const updatedFiles = (systemConfig.protectedFiles || []).map((f: any) => f.id === file.id ? { ...f, content: '' } : f);
                        const newConfig = { ...systemConfig, protectedFiles: updatedFiles };
                        setSystemConfig(newConfig);
                        try {
                          await setDoc(doc(getDb(), 'settings', 'global'), newConfig);
                          showToast('Contenido eliminado');
                        } catch (err) {
                          handleFirestoreError(err, OperationType.WRITE, 'settings/global');
                        }
                      }}
                      className="p-3 bg-red-50 text-red-600 border border-red-100 rounded-xl hover:bg-red-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Firestore Health Status Section */}
        <div className="bg-white rounded-3xl border border-slate-200 p-8 mb-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${dbStatus?.firestore ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Estado de Conexión Firestore</h3>
                <p className="text-xs text-slate-500">Validación de sincronización cloud en tiempo real.</p>
              </div>
            </div>
            <button 
              onClick={checkDbStatus}
              disabled={checkingStatus}
              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
              title="Actualizar estado"
            >
              <RefreshCw className={`w-5 h-5 ${checkingStatus ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Conectividad</p>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${dbStatus?.firestore ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'} transition-all`} />
                <p className={`font-bold ${dbStatus?.firestore ? 'text-emerald-700' : 'text-red-700'}`}>
                  {dbStatus?.firestore ? 'Conectado' : 'Desconectado'}
                </p>
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Modo de Datos</p>
              <p className="font-bold text-slate-700 uppercase">{dbStatus?.mode === 'cloud' ? 'Firebase Cloud' : 'JSON Local'}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">ID Base de Datos</p>
              <p className="font-mono text-xs font-bold text-slate-700">{dbStatus?.databaseId || '(default)'}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Project ID</p>
              <p className="font-mono text-xs font-bold text-slate-700 truncate">{dbStatus?.projectId || '---'}</p>
            </div>
          </div>

          {!dbStatus?.firestore && (
            <div className="flex flex-col gap-4">
              <div className="p-5 bg-red-50 border border-red-100 rounded-3xl">
                <div className="flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-bold text-red-900 mb-1">Error Detectado en el Servidor</h4>
                    <div className="font-mono text-[11px] text-red-700 bg-white/50 p-3 rounded-xl border border-red-100 break-all leading-relaxed mb-4">
                      {dbStatus?.error || 'No se pudo obtener el mensaje de error del servidor. Verifique los logs de Vercel.'}
                    </div>
                    
                    <div className="space-y-3">
                      <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Causas Probables:</h5>
                      <ul className="text-xs text-slate-600 list-disc list-inside space-y-1 ml-1">
                        <li>Las variables de entorno en Vercel no están configuradas (FIREBASE_SERVICE_ACCOUNT_KEY).</li>
                        <li>La Cuenta de Servicio de Google Cloud no tiene el rol "Propietario" o "Editor".</li>
                        <li>El ID de la base de datos es incorrecto (comúnmente se usa "(default)" pero en AI Studio puede variar).</li>
                        <li>La IP del servidor de Vercel está bloqueada o hay un desajuste de regiones.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="p-5 bg-slate-900 rounded-3xl text-white">
                <h4 className="text-sm font-black italic mb-2 tracking-tight group flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400" /> RESUMEN DE AMBIENTE VERCEL
                </h4>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 mt-4 text-[10px] font-mono opacity-80">
                  <div className="flex justify-between border-b border-white/10 pb-1">
                    <span>SA_KEY_PRESENT</span>
                    <span className={dbStatus?.env?.hasServiceAccountKey ? 'text-emerald-400' : 'text-red-400'}>{dbStatus?.env?.hasServiceAccountKey ? 'TRUE' : 'FALSE'}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/10 pb-1">
                    <span>PRIVATE_KEY_PRESENT</span>
                    <span className={dbStatus?.env?.hasPrivateKey ? 'text-emerald-400' : 'text-red-400'}>{dbStatus?.env?.hasPrivateKey ? 'TRUE' : 'FALSE'}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/10 pb-1">
                    <span>SA_ID_MATCH</span>
                    <span className={dbStatus?.projectId === dbStatus?.serviceAccountProjectId ? 'text-emerald-400' : 'text-red-400'}>
                      {dbStatus?.projectId === dbStatus?.serviceAccountProjectId ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-white/10 pb-1">
                    <span>SA_EMAIL</span>
                    <span className="text-blue-300 truncate ml-2 max-w-[120px]">{dbStatus?.serviceAccount || '---'}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/10 pb-1">
                    <span>NODE_ENV</span>
                    <span className="text-blue-300">{dbStatus?.env?.nodeEnv || '---'}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/10 pb-1">
                    <span>IS_VERCEL</span>
                    <span className="text-blue-300">{dbStatus?.env?.isVercel ? 'TRUE' : 'FALSE'}</span>
                  </div>
                </div>
              </div>

              {/* Vercel Fix Instructions */}
              <div className="p-6 bg-blue-50 border border-blue-100 rounded-3xl">
                <div className="flex gap-4">
                  <div className="bg-blue-600 p-2 rounded-xl text-white">
                    <Info className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-bold text-blue-900 mb-2">Instrucciones de Reparación para Vercel</h4>
                    <p className="text-xs text-blue-800 mb-4 leading-relaxed">
                      Para que la aplicación se conecte a Firestore desde <strong>bloqueo.ticcol.com</strong>, debe configurar manualmente las credenciales en el panel de Vercel:
                    </p>
                    <ol className="text-[11px] text-blue-700 space-y-3 font-medium">
                      <li className="flex gap-2">
                        <span className="bg-blue-200 text-blue-800 w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0">1</span>
                        <span>Vaya a <strong>AI Studio Settings</strong> &gt; <strong>Secrets</strong> y busque <strong>FIREBASE_SERVICE_ACCOUNT_KEY</strong>.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="bg-blue-200 text-blue-800 w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0">2</span>
                        <span>En su proyecto de <strong>Vercel</strong>, navegue a <strong>Settings</strong> &gt; <strong>Environment Variables</strong>.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="bg-blue-200 text-blue-800 w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0">3</span>
                        <span>Agregue <code>FIREBASE_SERVICE_ACCOUNT_KEY</code> con el JSON completo y <code>FIREBASE_DATABASE_ID</code> con el ID de su base de datos.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="bg-blue-200 text-blue-800 w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0">4</span>
                        <span>Despliegue nuevamente su aplicación en Vercel para aplicar los cambios.</span>
                      </li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          )}

          {dbStatus?.firestore && dbStatus?.fallbackWorked && (
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
              <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-900">Modo de Recuperación Activo</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  La base de datos configurada [{dbStatus?.configuredDatabaseId}] falló, pero el sistema logró conectar exitosamente con la base de datos "(default)". 
                  Se recomienda actualizar el ID de base de datos en su configuración de Vercel.
                </p>
              </div>
            </div>
          )}

          {dbStatus?.firestore && !dbStatus?.fallbackWorked && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-100">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-xs font-bold">Conexión verificada: El servidor tiene acceso total a Firestore Cloud.</span>
            </div>
          )}
        </div>
      </div>
    )}

      {activeTab === 'isps' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Base de Datos ISP</h2>
            <p className="text-slate-500 font-medium">Gestiona los operadores y sus rangos de IP para el bloqueo dinámico.</p>
          </div>
          <button 
            onClick={() => setEditingIsp({ name: '', logo: '', ips: [], activationType: 'indefinite', status: 'active' })}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-blue-700 shadow-lg shadow-blue-100 transition-all"
          >
            <Plus className="w-4 h-4" /> Nuevo Operador
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 opacity-50">
            <div className="w-10 h-10 border-4 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
            <p className="mt-4 font-bold text-slate-400 uppercase tracking-widest text-xs">Cargando base de datos...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {isps.length === 0 && (
              <div className="col-span-full py-20 flex flex-col items-center justify-center bg-slate-50 border border-dashed border-slate-200 rounded-[2.5rem] text-center px-6">
                <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center mb-6 border border-slate-100">
                  <Database className="w-10 h-10 text-slate-300" />
                </div>
                <h3 className="text-xl font-extrabold text-slate-800 mb-2">Base de Datos no Inicializada</h3>
                <p className="text-sm text-slate-500 font-medium max-w-sm mb-8 leading-relaxed">
                  Parece que esta es la primera vez que inicia la aplicación o la sincronización con el servidor falló por falta de permisos en Google Cloud.
                </p>
                <button 
                  onClick={handleInitialSeed}
                  className="bg-slate-900 text-white px-10 py-4 rounded-2xl font-black italic tracking-tight hover:bg-slate-800 transition-all flex items-center gap-3 shadow-xl shadow-slate-200 group"
                >
                  <RefreshCw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" /> 
                  INICIALIZAR BASE DE DATOS
                </button>
              </div>
            )}
            {isps.map(isp => (
              <motion.div 
                key={isp.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-white rounded-2xl border ${isp.status === 'suspended' ? 'border-amber-200' : 'border-slate-200'} p-6 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group`}
              >
                {isp.status === 'suspended' && (
                  <div className="absolute top-0 right-0 p-3">
                    <div className="bg-amber-100 text-amber-600 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Suspendido
                    </div>
                  </div>
                )}
                <div className="flex items-start justify-between">
                  <div className="w-16 h-16 bg-slate-50 rounded-xl overflow-hidden border border-slate-100 flex items-center justify-center shrink-0">
                    <img src={isp.logo || DEFAULT_LOGO} alt={isp.name} className="max-w-full max-h-full object-contain p-2" referrerPolicy="no-referrer" />
                  </div>
                  <div className="flex gap-1">
                    {/* Toggle Status for indefinite */}
                    {isp.activationType === 'indefinite' && (
                      <button 
                        onClick={async () => {
                          const newStatus = isp.status === 'active' ? 'suspended' : 'active';
                          try {
                            await updateDoc(doc(getDb(), 'isps', isp.id!), { 
                              status: newStatus,
                              updatedAt: Timestamp.now()
                            });
                            showToast(newStatus === 'active' ? 'Operador activado' : 'Operador suspendido');
                          } catch (err) {
                            handleFirestoreError(err, OperationType.UPDATE, `isps/${isp.id}`);
                          }
                        }}
                        className={`p-2 rounded-lg transition-all ${isp.status === 'active' ? 'text-amber-500 hover:bg-amber-50' : 'text-emerald-500 hover:bg-emerald-50'}`}
                        title={isp.status === 'active' ? 'Suspender' : 'Activar'}
                      >
                         <ShieldAlert className="w-4 h-4" />
                      </button>
                    )}

                    {/* Renew for monthly */}
                    {isp.activationType === 'monthly' && (
                      <button 
                        onClick={async () => {
                          const expiry = new Date();
                          expiry.setDate(expiry.getDate() + 30);
                          try {
                            await updateDoc(doc(getDb(), 'isps', isp.id!), { 
                              status: 'active', 
                              expiresAt: expiry.toISOString(),
                              updatedAt: Timestamp.now()
                            });
                            showToast('Suscripción renovada por 30 días');
                          } catch (err) {
                            handleFirestoreError(err, OperationType.UPDATE, `isps/${isp.id}`);
                          }
                        }}
                        className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all"
                        title="Activar/Renovar 30 días"
                      >
                         <Save className="w-4 h-4" />
                      </button>
                    )}

                    <button 
                      onClick={() => setEditingIsp(isp)}
                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    
                    {isp.activationType !== 'default' && (
                      <button 
                        onClick={() => setIspToDelete(isp.id!)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                
                <div>
                  <div className="flex items-center justify-between border-b border-slate-50 pb-2 mb-3">
                    <h3 className="font-bold text-slate-900 line-clamp-1">{isp.name}</h3>
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest ${
                      isp.activationType === 'default' ? 'bg-blue-50 text-blue-600' :
                      isp.activationType === 'monthly' ? 'bg-purple-50 text-purple-600' :
                      'bg-slate-100 text-slate-500'
                    }`}>
                      {isp.activationType}
                    </span>
                  </div>
                  
                  {isp.activationType === 'monthly' && isp.expiresAt && (
                    <div className="mb-3">
                       <p className="text-[10px] font-bold text-slate-400 flex justify-between">
                         <span>Vence:</span>
                         <span className={new Date(isp.expiresAt) < new Date() ? 'text-red-500' : 'text-slate-600'}>
                           {new Date(isp.expiresAt).toLocaleDateString()}
                         </span>
                       </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
                      {isp.ips.map((prefix, idx) => (
                        <span key={idx} className="bg-slate-100 text-slate-600 font-mono text-[9px] px-1.5 py-0.5 rounded border border-slate-200">
                          {prefix}*
                        </span>
                      ))}
                    </div>
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-2">Prefijos de IP ({isp.ips.length})</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    )}
    </main>

      <AnimatePresence>
        {editingIsp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-0">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingIsp(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200"
            >
              <form onSubmit={handleSave} className="flex flex-col h-full">
                <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-100 italic font-bold text-blue-600">
                      ?
                    </div>
                    <div>
                      <h2 className="text-xl font-extrabold text-slate-900">{editingIsp.id ? 'Editar Operador' : 'Nuevo Operador'}</h2>
                      <p className="text-xs text-slate-500 font-medium">Configura los detalles del ISP en la red.</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setEditingIsp(null)} className="p-2 hover:bg-white rounded-full transition-colors">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>

                <div className="p-8 space-y-6">
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">ASN (Opcional)</label>
                        <div className="flex gap-2">
                          <input 
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                            placeholder="Ej: 13414"
                            value={editingIsp.asn || ''}
                            onChange={e => setEditingIsp({...editingIsp, asn: e.target.value})}
                          />
                          <button 
                            type="button"
                            onClick={handleASNLookup}
                            disabled={!editingIsp.asn || lookupLoading}
                            className="px-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center justify-center shrink-0"
                            title="Consultar por ASN"
                          >
                            {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 text-blue-600" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Nombre de la Empresa</label>
                        <input 
                          required
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                          placeholder="Ej: Claro Colombia"
                          value={editingIsp.name}
                          onChange={e => setEditingIsp({...editingIsp, name: e.target.value})}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Configuración en JSON (Importar datos)</label>
                      <textarea
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono min-h-[100px]"
                        placeholder='{"name": "ISP Ejemplo", "ips": ["1.1.1.1/24"]}'
                        onChange={e => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            setEditingIsp({...editingIsp, ...parsed});
                          } catch (err) {}
                        }}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Tipo de Activación</label>
                      <select 
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                        value={editingIsp.activationType || 'indefinite'}
                        onChange={e => {
                          const type = e.target.value as any;
                          setEditingIsp({
                            ...editingIsp, 
                            activationType: type,
                            status: type === 'default' ? 'active' : (editingIsp.status || 'active')
                          });
                        }}
                      >
                        <option value="default">Default (Permanente, sin suspensión)</option>
                        <option value="indefinite">Indefinido (Manual, con suspensión)</option>
                        <option value="monthly">Mensual (Auto-suspensión tras 30 días)</option>
                      </select>
                      <p className="text-[10px] text-slate-400 mt-2 italic">
                        {editingIsp.activationType === 'default' && "Los operadores 'Default' no pueden ser suspendidos ni eliminados accidentalmente."}
                        {editingIsp.activationType === 'indefinite' && "Permanecen activos hasta que un administrador decida suspenderlos manualmente."}
                        {editingIsp.activationType === 'monthly' && "Requiere activación manual para iniciar el periodo de 30 días."}
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Logotipo del ISP</label>
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1 space-y-2">
                          <input 
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                            placeholder="URL del logotipo (ej: https://...)"
                            value={editingIsp.logo}
                            onChange={e => setEditingIsp({...editingIsp, logo: e.target.value})}
                          />
                          <div className="flex items-center gap-2">
                            <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white border border-dashed border-slate-300 rounded-xl hover:border-blue-400 hover:bg-slate-50 transition-all cursor-pointer text-[11px] font-black uppercase tracking-widest text-slate-500">
                              <Upload className="w-4 h-4" /> Subir Imagen (Max 2MB)
                              <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                            </label>
                          </div>
                        </div>
                        <AnimatePresence mode="wait">
                          {editingIsp.logo ? (
                            <motion.div 
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="w-32 h-24 bg-slate-50 rounded-2xl flex items-center justify-center p-3 border border-slate-200 shrink-0 relative group"
                            >
                              <img 
                                key={editingIsp.logo}
                                src={editingIsp.logo || DEFAULT_LOGO} 
                                alt="Preview" 
                                className="max-h-full max-w-full object-contain" 
                                onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_LOGO; }}
                              />
                              <div className="absolute inset-0 bg-white/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-2xl">
                                <span className="text-[8px] font-black uppercase tracking-tighter text-slate-900 bg-white px-2 py-1 rounded-full shadow-sm">Vista Previa</span>
                              </div>
                            </motion.div>
                          ) : (
                            <div className="w-32 h-24 bg-slate-50 rounded-2xl flex items-center justify-center border border-dashed border-slate-200 shrink-0">
                               <Database className="w-6 h-6 text-slate-300" />
                            </div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1.5 ml-1">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Prefijos de IP (Separados por coma)</label>
                        <label className="text-[10px] font-bold text-blue-600 hover:text-blue-700 cursor-pointer flex items-center gap-1 transition-colors">
                          <Upload className="w-3 h-3" /> Cargar TXT/CSV
                          <input 
                            type="file" 
                            className="hidden" 
                            accept=".txt,.csv" 
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                const content = event.target?.result as string;
                                // Split by comma, newline, or semicolon
                                const newIps = content.split(/[\n,\s;]+/).map(s => s.trim()).filter(s => s);
                                const currentIps = editingIsp.ips || [];
                                const combined = [...new Set([...currentIps, ...newIps])];
                                setEditingIsp({ ...editingIsp, ips: combined });
                                showToast(`${newIps.length} IPs detectadas`);
                              };
                              reader.readAsText(file);
                            }}
                          />
                        </label>
                      </div>
                      <textarea 
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium min-h-[100px] font-mono"
                        placeholder="Ej: 190.157., 186.28."
                        value={editingIsp.ips?.join(', ')}
                        onChange={e => setEditingIsp({...editingIsp, ips: e.target.value.split(',').map(s => s.trim()).filter(s => s)})}
                      />
                      <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1 leading-normal italic">
                        <Info className="w-3 h-3 shrink-0" />
                        Soporta prefijos (190.157.), CIDR (186.28.0.0/16) e IPv6 (2800:480::/32).
                      </p>
                    </div>
                  </div>
                </div>

                <div className="px-8 py-6 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-3">
                  <button 
                    type="submit"
                    disabled={lookupLoading}
                    className="flex-1 bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 shadow-xl shadow-slate-200 transition-all flex items-center justify-center gap-2 min-w-[200px] disabled:opacity-50"
                  >
                    {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {lookupLoading ? 'Guardando...' : (editingIsp.id ? 'Guardar Cambios' : 'Crear Operador')}
                  </button>
                  
                  {editingIsp.id && (
                    <button 
                      type="button"
                      onClick={() => setIspToDelete(editingIsp.id!)}
                      className="px-6 bg-red-50 border border-red-100 text-red-600 font-bold py-4 rounded-2xl hover:bg-red-100 transition-all flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" /> Eliminar
                    </button>
                  )}

                  <button 
                    type="button"
                    onClick={() => setEditingIsp(null)}
                    className="px-6 bg-white border border-slate-200 text-slate-700 font-bold py-4 rounded-2xl hover:bg-slate-100 transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

        <AnimatePresence>
          {ispToDelete && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIspToDelete(null)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 border border-slate-200 text-center"
              >
                <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-red-100">
                  <Trash2 className="w-8 h-8 text-red-600" />
                </div>
                <h2 className="text-xl font-extrabold text-slate-900 mb-2">¿Eliminar Operador?</h2>
                <p className="text-sm text-slate-500 font-medium mb-8">Esta acción es permanente y no se puede deshacer.</p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setIspToDelete(null)}
                    disabled={loading}
                    className="flex-1 px-4 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all italic tracking-tight disabled:opacity-50"
                  >
                    No, Cancelar
                  </button>
                  <button 
                    onClick={() => handleDelete(ispToDelete)}
                    disabled={loading}
                    className="flex-1 px-4 py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 shadow-lg shadow-red-100 transition-all italic tracking-tight disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sí, Eliminar'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        
        <AnimatePresence>
          {toast && <Toast message={toast} onClose={() => setToast(null)} />}
        </AnimatePresence>
    </div>
  );
}

function Toast({ message, onClose }: { message: string, onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, x: '-50%' }}
      animate={{ opacity: 1, y: 0, x: '-50%' }}
      exit={{ opacity: 0, y: 50, x: '-50%' }}
      className="fixed bottom-10 left-1/2 z-[100] bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/10 backdrop-blur-md"
    >
      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
      <span className="text-sm font-black italic tracking-tight uppercase">{message}</span>
    </motion.div>
  );
}
