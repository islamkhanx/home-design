import AppKit
import Foundation
let root=URL(fileURLWithPath:CommandLine.arguments[1]);let w=2700,h=2250
let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:w,pixelsHigh:h,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
let ctx=NSGraphicsContext(bitmapImageRep:bitmap)!
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=ctx
ctx.cgContext.translateBy(x:0,y:CGFloat(h));ctx.cgContext.scaleBy(x:1,y:-1)
NSGraphicsContext.current=NSGraphicsContext(cgContext:ctx.cgContext,flipped:true)
NSColor(srgbRed:0.96,green:0.95,blue:0.93,alpha:1).setFill();NSRect(x:0,y:0,width:w,height:h).fill()
func text(_ s:String,_ x:Double,_ y:Double,_ size:Double=30,_ bold:Bool=false){
 (s as NSString).draw(at:NSPoint(x:x,y:y),withAttributes:[.font:NSFont.systemFont(ofSize:size,weight:bold ? .semibold:.regular),.foregroundColor:NSColor(srgbRed:0.19,green:0.25,blue:0.23,alpha:1)])
}
text("САНУЗЕЛ · ТРИ ВАРИАНТА В ОБЪЁМЕ",55,32,49,true)
text("Одна геометрическая модель · одинаковый масштаб · студийный свет для сравнения объёмов",55,102,29)
let names=["A  Отдельные блоки","B  Общая столешница","C  Длинный блок слева"]
for (i,v) in ["A","B","C"].enumerated(){
 let x=Double(i*900)
 text(names[i],x+40,164,34,true)
 for (j,view) in ["bath","entry"].enumerated(){
  let im=NSImage(contentsOf:root.appendingPathComponent("volume-\(v)-\(view).png"))!
  im.draw(in:NSRect(x:x,y:220+Double(j)*920,width:900,height:900),from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,hints:nil)
 }
 text(["3 объёма хранения · отдельная стиралка","Широкое зеркало · общий блок на торце","WC напротив стиралки · проход 625 мм*"][i],x+35,2070,26,true)
}
text("Верхний ряд: все предметы. Нижний: обратный ракурс без верхних шкафов, чтобы видеть проходы. Ближние стены скрыты.",55,2130,27)
text("* Размеры условные: 1800 × 2470 × 2700 мм. Схемы не утверждены. Материалы условные; свет не является расчётом освещения.",55,2180,26)
NSGraphicsContext.restoreGraphicsState()
try! bitmap.representation(using:.png,properties:[:])!.write(to:root.appendingPathComponent("bathroom-volumes-comparison.png"))
