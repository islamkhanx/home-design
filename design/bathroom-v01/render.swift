import AppKit
import Foundation
let width=2000.0, height=Double(CommandLine.arguments[3])!
func number(_ s:String?,_ fallback:Double=0)->Double { Double(s ?? "") ?? fallback }
func color(_ s:String)->NSColor { var v=UInt64(0); Scanner(string:s.replacingOccurrences(of:"#",with:"")).scanHexInt64(&v); if s.count == 4 {let r=(v>>8)&15,g=(v>>4)&15,b=v&15;return NSColor(srgbRed:Double(r)/15,green:Double(g)/15,blue:Double(b)/15,alpha:1)};return NSColor(srgbRed:Double((v>>16)&255)/255,green:Double((v>>8)&255)/255,blue:Double(v&255)/255,alpha:1) }
class Render:NSObject,XMLParserDelegate {
 var group=false; var textAttrs:[String:String]?;var buffer=""
 func x(_ v:Double)->Double {group ? 500+(v-660)*1.8:v}
 func y(_ v:Double)->Double {group ? 185+(v-210)*1.8:v}
 var scale:Double {group ? 1.8:1}
 func pt(_ a:Double,_ b:Double)->NSPoint {NSPoint(x:x(a),y:y(b))}
 func draw(_ b:NSBezierPath,_ a:[String:String]) {
  if let f=a["fill"],f != "none" {color(f).setFill();b.fill()}
  if let s=a["stroke"],s != "none" {color(s).setStroke();b.lineWidth=number(a["stroke-width"],1)*scale
   let ds=(a["stroke-dasharray"] ?? "").split(separator:" ").compactMap{Double($0)}.map{CGFloat($0*scale)}
   if !ds.isEmpty {b.setLineDash(ds,count:ds.count,phase:0)}
   b.stroke()
  }
 }
 func parser(_ parser:XMLParser,didStartElement n:String,namespaceURI:String?,qualifiedName:String?,attributes a:[String:String]) {
  if n == "g" {group=true;return}
  if n == "rect" {let r=NSRect(x:x(number(a["x"])),y:y(number(a["y"])),width:number(a["width"])*scale,height:number(a["height"])*scale);draw(NSBezierPath(roundedRect:r,xRadius:number(a["rx"])*scale,yRadius:number(a["rx"])*scale),a)}
  if n == "circle" {let r=number(a["r"]);draw(NSBezierPath(ovalIn:NSRect(x:x(number(a["cx"])-r),y:y(number(a["cy"])-r),width:r*2*scale,height:r*2*scale)),a)}
  if n == "text" {textAttrs=a;buffer=""}
  if n == "path" {
   let d=a["d"] ?? ""; let regex=try! NSRegularExpression(pattern:"[MLHVQZmlhvqz]|-?[0-9]+(?:\\.[0-9]+)?")
   let ns=d as NSString;let ts=regex.matches(in:d,range:NSRange(location:0,length:ns.length)).map{ns.substring(with:$0.range)}
   var i=0;var cx=0.0,cy=0.0;let b=NSBezierPath()
   func next()->Double {defer{i+=1};return Double(ts[i])!}
   while i<ts.count {let c=ts[i];i+=1
    if c == "M" || c == "L" {cx=next();cy=next();if c == "M" {b.move(to:pt(cx,cy))}else{b.line(to:pt(cx,cy))}}
    else if c == "H" {cx=next();b.line(to:pt(cx,cy))}
    else if c == "V" {cy=next();b.line(to:pt(cx,cy))}
    else if c == "Q" {let qx=next(),qy=next(),ex=next(),ey=next();b.curve(to:pt(ex,ey),controlPoint1:pt(cx+2*(qx-cx)/3,cy+2*(qy-cy)/3),controlPoint2:pt(ex+2*(qx-ex)/3,ey+2*(qy-ey)/3));cx=ex;cy=ey}
    else if c == "Z" {b.close()}
   };draw(b,a)
  }
 }
 func parser(_ parser:XMLParser,foundCharacters s:String) {if textAttrs != nil {buffer+=s}}
 func parser(_ parser:XMLParser,didEndElement n:String,namespaceURI:String?,qualifiedName:String?) {
  if n == "g" {group=false}
  if n == "text",let a=textAttrs {let size=number(a["font-size"],20)*scale;let font=NSFont.systemFont(ofSize:size,weight:number(a["font-weight"])>=700 ? .bold:.regular);let fill=a["fill"] == "white" ? NSColor.white:color(a["fill"] ?? "#243341");(buffer as NSString).draw(at:NSPoint(x:x(number(a["x"])),y:y(number(a["y"]))-font.ascender),withAttributes:[.font:font,.foregroundColor:fill]);textAttrs=nil}
 }
}
let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:Int(width),pixelsHigh:Int(height),bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
let context=NSGraphicsContext(bitmapImageRep:bitmap)!
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=context
context.cgContext.translateBy(x:0,y:height);context.cgContext.scaleBy(x:1,y:-1)
NSGraphicsContext.current=NSGraphicsContext(cgContext:context.cgContext,flipped:true)
let renderer=Render();let parser=XMLParser(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))!;parser.delegate=renderer
guard parser.parse() else {fatalError("XML parse failed")}
NSGraphicsContext.restoreGraphicsState()
try! bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[2]))
