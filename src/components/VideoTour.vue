<script setup lang="ts">
import {ref,computed,onMounted,onBeforeUnmount} from 'vue'
const preset=ref('preview'),seconds=ref(32),fps=ref(24),device=ref('auto'),token=ref(''),available=ref(false),error=ref(''),busy=ref(false)
const state=ref<any>({phase:'idle',completed:0,total:0,percent:0})
const running=computed(()=>['starting','exporting','importing','rendering','encoding'].includes(state.value.phase))
const labels:Record<string,string>={idle:'Готов к запуску',starting:'Запуск',exporting:'Подготовка модели',importing:'Импорт в Blender',rendering:'Рендер кадров',encoding:'Сборка MP4',paused:'Пауза',done:'Видео готово',error:'Рендер остановлен'}
const time=(n:number|null)=>n==null?'После первых кадров':`${Math.floor(n/3600)} ч ${Math.floor(n%3600/60)} мин ${Math.floor(n%60)} с`
let timer:ReturnType<typeof setTimeout>|undefined,stopped=false
async function poll(){
  try{const r=await fetch('/__local/tour/status');if(!r.ok)throw new Error('Progress unavailable');state.value=await r.json()}
  catch{error.value='Нет связи с локальным сервером. Кадры сохраняются на диске; вернитесь после восстановления связи.'}
  finally{if(!stopped)timer=setTimeout(poll,2000)}
}
onMounted(async()=>{
  if(location.protocol==='file:')return
  try{const r=await fetch('/__local/status');const data=await r.json();token.value=data.token;available.value=data.available;if(available.value)poll()}
  catch{error.value='Для рендера запустите локальное приложение: npm run dev'}
})
onBeforeUnmount(()=>{stopped=true;clearTimeout(timer)})
async function action(name:string){
  busy.value=true;error.value=''
  try{const r=await fetch('/__local/tour/'+name,{method:'POST',headers:{'Content-Type':'application/json','x-render-token':token.value},body:JSON.stringify({preset:preset.value,seconds:seconds.value,fps:fps.value,device:device.value})});const data=await r.json();if(!r.ok)throw new Error(data.error)
    if(name==='pause')error.value='Пауза запрошена. Текущий кадр будет дорендерен.'
    else state.value={...state.value,phase:'starting',percent:0}
  }catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
</script>
<template>
  <section class="tour-workspace">
    <p class="eyebrow">HOME / BLENDER CYCLES</p><h2>Видеотур по квартире.</h2>
    <p class="tour-intro">Общий вид, шесть помещений, потолки и свет. Плавное движение камеры в каждом ракурсе и монтажные переходы между комнатами.</p>
    <div class="tour-notice">Интерьер предложен автоматически. Контур восстановлен по исходному плану; точные размеры требуют обмера. Эта отметка сохраняется в видео.</div>
    <template v-if="available">
      <div class="tour-settings"><label>Качество<select v-model="preset" :disabled="running"><option value="draft">Черновик · 480 × 270</option><option value="preview">Просмотр · 960 × 540</option><option value="quality">Финал · 1920 × 1080</option></select></label><label>Длительность, с<input v-model.number="seconds" :disabled="running" type="number" min="2" max="180"></label><label>Кадров в секунду<select v-model.number="fps" :disabled="running"><option :value="12">12</option><option :value="24">24</option><option :value="30">30</option></select></label></div>
      <div class="tour-settings"><label>Устройство<select v-model="device" :disabled="running"><option value="auto">Авто · GPU, иначе CPU</option><option value="gpu">Только GPU · Metal на Mac</option><option value="cpu">Только CPU</option></select></label></div>
      <div class="tour-actions"><button v-if="!running" :disabled="busy" @click="action('start')">Создать новый тур</button><button v-if="state.canResume && !running && state.phase!=='done'" :disabled="busy" @click="action('resume')">Продолжить сохранённый</button><button v-if="running && state.phase!=='encoding'" :disabled="busy" @click="action('pause')">Пауза после кадра</button></div>
      <div class="tour-progress" aria-live="polite"><div><b>{{ labels[state.phase]??state.phase }}</b><span>{{ Math.floor(state.percent) }}%</span></div><progress max="100" :value="state.percent" aria-label="Прогресс рендера"></progress><p>{{ state.shot??state.message }}</p><div class="tour-stats"><span><b>{{ state.completed }} / {{ state.total }}</b>кадров сохранено</span><span><b>{{ time(state.elapsedSeconds??0) }}</b>время текущего запуска</span><span><b>{{ time(state.etaSeconds??null) }}</b>примерно осталось на рендер</span><span><b>{{ state.device??'—' }}</b>устройство Cycles</span></div></div>
      <p v-if="state.phase==='error'" role="alert" class="tour-notice">{{ state.message }}</p>
      <video v-if="state.phase==='done'" :key="state.finishedAt" controls :src="'/__local/tour/video?v='+encodeURIComponent(state.finishedAt??'')"></video><a v-if="state.phase==='done'" class="tour-download" href="/__local/tour/video" download="home-video-tour.mp4">Скачать MP4</a>
      <p class="tour-help">Можно закрыть вкладку: рендер продолжится, пока компьютер включён. После перезапуска используйте «Продолжить»: готовые кадры не пересчитываются. Финальная сборка MP4 выполняется после рендера; оценка времени уточняется по готовым кадрам.</p>
    </template>
    <div v-else class="tour-progress"><h3>Рендер выполняется на вашем компьютере</h3><p>Откройте приложение через <code>npm run dev</code>, чтобы запустить тур и следить за прогрессом здесь. Автономный HTML не запускает Blender.</p><p>Или запустите в терминале:</p><code>npm run tour -- --background</code><p>Панель прогресса: <code>exports/video-tour/progress.html</code></p></div>
    <p v-if="error" role="status" class="tour-notice">{{ error }}</p>
  </section>
</template>
<style scoped>
.tour-workspace{max-width:1120px;margin:auto;padding:45px 32px 70px;color:#344130}.tour-workspace h2{font-size:44px;font-weight:450;letter-spacing:-1.5px;margin:12px 0}.tour-intro{max-width:650px;line-height:1.7;color:#77816b}.tour-notice{background:#eee9db;padding:16px 20px;border-radius:9px;font-size:12px;line-height:1.6}.tour-settings{display:flex;gap:20px;margin:28px 0;flex-wrap:wrap}.tour-settings label{display:flex;flex-direction:column;gap:9px;font-size:12px}.tour-settings select,.tour-settings input{font:inherit;padding:12px;border:1px solid #d6decd;border-radius:7px;background:white}.tour-settings input{width:140px}.tour-actions{display:flex;gap:12px}.tour-actions button,.tour-download{padding:13px 20px;border:0;border-radius:7px;background:#4d6443;color:white;font:inherit;font-size:13px;text-decoration:none;cursor:pointer}.tour-actions button:disabled{opacity:.5}.tour-progress{margin:28px 0;padding:26px;background:white;border:1px solid #dfe3d8;border-radius:12px}.tour-progress>div:first-child{display:flex;justify-content:space-between}.tour-progress progress{width:100%;height:20px;accent-color:#637e50;margin:16px 0}.tour-progress p,.tour-help{font-size:12px;color:#7d856f;line-height:1.7}.tour-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.tour-stats span{font-size:11px;color:#818b76}.tour-stats b{display:block;color:#43583a;font-size:17px;margin-bottom:6px}video{width:100%;border-radius:12px;margin-bottom:20px}.tour-help{margin-top:28px}code{overflow-wrap:anywhere}@media(max-width:700px){.tour-workspace{padding:24px 18px}.tour-workspace h2{font-size:32px}.tour-stats{grid-template-columns:1fr 1fr}.tour-actions{flex-wrap:wrap}}
</style>
