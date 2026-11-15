// Native macOS PDF backend. Cross-platform users can print documents.html in a browser.
// Consumes the same structured dossier as the browser, with real text and vector drawings.
import Foundation
import AppKit
import CoreGraphics
import PDFKit

struct Table: Decodable { let headers: [String]; let rows: [[String]] }
struct Sheet: Decodable { let id: String; let title: String; let status: String; let paragraphs: [String]; let table: Table?; let svg: String? }
struct Dossier: Decodable { let title: String; let revision: String; let generatedAt: String; let scope: String; let sheets: [Sheet] }
func color(_ hex: String) -> NSColor {
    var clean = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    if clean == "white" {clean="ffffff"}
    if clean == "black" {clean="000000"}
    if clean.count==3 {clean=clean.map{String(repeating:String($0),count:2)}.joined()}
    let value = UInt32(clean, radix: 16) ?? 0x30372f
    return NSColor(srgbRed: CGFloat((value >> 16) & 255)/255, green: CGFloat((value >> 8) & 255)/255, blue: CGFloat(value & 255)/255, alpha: 1)
}
let ink = color("30372f"), muted = color("78846d"), olive = color("536747")
func attrs(_ size: CGFloat, _ bold: Bool = false, _ shade: NSColor = ink) -> [NSAttributedString.Key: Any] {
    let style = NSMutableParagraphStyle(); style.lineBreakMode = .byWordWrapping; style.lineSpacing = 2
    return [.font: NSFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular), .foregroundColor: shade, .paragraphStyle: style]
}
func textHeight(_ text: String, _ width: CGFloat, _ size: CGFloat = 10, _ bold: Bool = false) -> CGFloat {
    ceil((text as NSString).boundingRect(with: NSSize(width: width, height: 10000), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attrs(size,bold)).height)
}
@discardableResult func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ size: CGFloat = 10, _ bold: Bool = false, _ shade: NSColor = ink) -> CGFloat {
    let h = textHeight(value,width,size,bold)
    (value as NSString).draw(in: NSRect(x:x,y:y,width:width,height:h+2), withAttributes:attrs(size,bold,shade))
    return h
}

// Render only the SVG primitives emitted by drawings.ts. Unknown elements fail closed.
final class SVG: NSObject, XMLParserDelegate {
    let ctx: CGContext
    var error: String?
    var attributes: [String: String] = [:]
    var content = ""
    init(_ ctx: CGContext) { self.ctx = ctx }
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes a: [String:String]) {
        if name == "svg" { return }
        if name == "text" { attributes = a; content = ""; return }
        func v(_ k: String, _ fallback: Double = 0) -> CGFloat { CGFloat(Double(a[k] ?? "") ?? fallback) }
        ctx.saveGState()
        defer { ctx.restoreGState() }
        ctx.setLineWidth(v("stroke-width",1))
        if a["stroke-dasharray"] != nil {ctx.setLineDash(phase:0,lengths:[4,3])}
        if let fill = a["fill"] {ctx.setFillColor(color(fill).cgColor)}
        if let stroke = a["stroke"] {ctx.setStrokeColor(color(stroke).cgColor)}
        let path=CGMutablePath()
        switch name {
        case "rect": path.addRect(CGRect(x:v("x"),y:v("y"),width:v("width"),height:v("height")))
        case "circle": path.addEllipse(in:CGRect(x:v("cx")-v("r"),y:v("cy")-v("r"),width:v("r")*2,height:v("r")*2))
        case "line": path.move(to:CGPoint(x:v("x1"),y:v("y1")));path.addLine(to:CGPoint(x:v("x2"),y:v("y2")))
        case "polygon":
            let points=(a["points"] ?? "").split(separator:" ").compactMap { token -> CGPoint? in
                let pair=token.split(separator:",").compactMap {Double($0)}
                return pair.count==2 ? CGPoint(x:pair[0],y:pair[1]) : nil
            }
            if let first=points.first {path.move(to:first);for p in points.dropFirst(){path.addLine(to:p)};path.closeSubpath()}
        default: error="Unsupported SVG element: \(name)";parser.abortParsing();return
        }
        ctx.addPath(path)
        if name=="line" {ctx.strokePath()}
        else if a["stroke"] != nil && a["fill"] != nil {ctx.drawPath(using:.fillStroke)}
        else if a["stroke"] != nil {ctx.strokePath()}
        else {ctx.fillPath()}
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {content += string}
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        guard name=="text" else {return}
        let size=CGFloat(Double(attributes["font-size"] ?? "13") ?? 13)
        let x=CGFloat(Double(attributes["x"] ?? "0") ?? 0), y=CGFloat(Double(attributes["y"] ?? "0") ?? 0)
        let width=(content as NSString).size(withAttributes:attrs(size)).width+4
        let shift=attributes["text-anchor"] == "middle" ? width/2 : 0
        text(content,x-shift,y-size,width,size,false,color(attributes["fill"] ?? "30372f"))
    }
}

let args=CommandLine.arguments
guard args.count >= 3 else {fputs("Usage: swift print-documents.swift dossier.json documents.pdf [qa-directory]\n",stderr);exit(1)}
let dossier=try JSONDecoder().decode(Dossier.self,from:Data(contentsOf:URL(fileURLWithPath:args[1])))
let output=URL(fileURLWithPath:args[2])
let W: CGFloat = 841.89, H: CGFloat = 595.28, margin: CGFloat = 34, contentWidth: CGFloat = 773.89
var box=CGRect(x:0,y:0,width:W,height:H)
guard let consumer=CGDataConsumer(url:output as CFURL), let ctx=CGContext(consumer:consumer,mediaBox:&box,[kCGPDFContextTitle:dossier.title,kCGPDFContextCreator:"Home Design document generator"] as CFDictionary) else {fatalError("Cannot create PDF")}
var page=0, y: CGFloat=0
var sheetTitle="", sheetId="", sheetStatus=""
func beginPage(_ continuation: Bool=false) {
    page+=1;ctx.beginPDFPage(nil);ctx.saveGState();ctx.translateBy(x:0,y:H);ctx.scaleBy(x:1,y:-1)
    NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(cgContext:ctx,flipped:true)
    ctx.setFillColor(NSColor.white.cgColor);ctx.fill(CGRect(x:0,y:0,width:W,height:H))
    text("HOME / DOCUMENTS",margin,25,220,9,true,olive)
    text("\(dossier.revision)  /  \(sheetId)",W-350,25,316,8,false,muted)
    ctx.setStrokeColor(olive.cgColor);ctx.setLineWidth(1);ctx.move(to:CGPoint(x:margin,y:46));ctx.addLine(to:CGPoint(x:W-margin,y:46));ctx.strokePath()
    y=60
    y+=text(sheetTitle+(continuation ? " · продолжение" : ""),margin,y,contentWidth,21,false)+8
    y+=text(sheetStatus,margin,y,contentWidth,9,true,color("937235"))+14
}
func endPage() {
    ctx.setStrokeColor(color("d7ddcd").cgColor);ctx.setLineWidth(0.5);ctx.move(to:CGPoint(x:margin,y:H-36));ctx.addLine(to:CGPoint(x:W-margin,y:H-36));ctx.strokePath()
    text("ПРЕДВАРИТЕЛЬНО · НЕ ДЛЯ ПРОИЗВОДСТВА РАБОТ",margin,H-26,510,8,false,muted)
    text("\(dossier.generatedAt.prefix(10))  /  \(sheetId)  /  стр. \(page)",W-280,H-26,246,8,false,muted)
    NSGraphicsContext.restoreGraphicsState();ctx.restoreGState();ctx.endPDFPage()
}
func ensure(_ height: CGFloat) {if y+height>H-50 {endPage();beginPage(true)}}
func drawRow(_ cells:[String], _ widths:[CGFloat], _ heading:Bool=false, _ even:Bool=false) {
    let h=max(25,(zip(cells,widths).map {textHeight($0.0,$0.1-14,heading ? 9 : 9.5,heading)}.max() ?? 15)+14)
    ensure(h)
    var x=margin
    for (i,cell) in cells.enumerated() {
        let w=widths[i]
        ctx.setFillColor(color(heading ? "e5ebde" : even ? "f5f7f1" : "ffffff").cgColor)
        ctx.fill(CGRect(x:x,y:y,width:w,height:h))
        ctx.setStrokeColor(color("d9dfd1").cgColor);ctx.setLineWidth(0.4);ctx.stroke(CGRect(x:x,y:y,width:w,height:h))
        text(cell,x+7,y+6,w-14,heading ? 9 : 9.5,heading)
        x+=w
    }
    y+=h
}
// First pages: contents with stable sheet IDs (physical page numbers may include continuations).
sheetTitle=dossier.title;sheetId="INDEX";sheetStatus="Состав предварительного выпуска"
beginPage()
y+=text(dossier.scope,margin,y,contentWidth,11)+12
for s in dossier.sheets {
    let title="\(s.id)    \(s.title)"
    let h=textHeight(title,contentWidth,10)+6
    ensure(h);y+=text(title,margin,y,contentWidth,10)+6
}
endPage()
for sheet in dossier.sheets {
    sheetTitle=sheet.title;sheetId=sheet.id;sheetStatus=sheet.status;beginPage()
    for p in sheet.paragraphs {
        // Bound chunks so a long user-supplied note can never overrun a page.
        let chars=Array(p)
        for start in stride(from:0,to:chars.count,by:1200) {
            let chunk=String(chars[start..<min(start+1200,chars.count)])
            let h=textHeight(chunk,contentWidth,10)+10;ensure(h);y+=text(chunk,margin,y,contentWidth,10)+10
        }
    }
    if let svg=sheet.svg {
        let available=H-55-y, scale=min(contentWidth/820,available/660)
        ctx.saveGState();ctx.translateBy(x:margin+(contentWidth-820*scale)/2,y:y);ctx.scaleBy(x:scale,y:scale);ctx.clip(to:CGRect(x:0,y:0,width:820,height:660))
        let renderer=SVG(ctx), parser=XMLParser(data:Data(svg.utf8));parser.delegate=renderer
        guard parser.parse(),renderer.error==nil else {fatalError(renderer.error ?? "Invalid SVG")}
        ctx.restoreGState();y+=660*scale
    }
    if let table=sheet.table {
        let columns=table.headers.count
        let weights:[CGFloat] = columns==6 ? [0.16,0.30,0.08,0.16,0.14,0.16] : Array(repeating:1/CGFloat(columns),count:columns)
        let widths=weights.map{$0*contentWidth/weights.reduce(0,+)}
        drawRow(table.headers,widths,true)
        for (i,row) in table.rows.enumerated() {
            let pieces=row.map {Array($0)}
            let segments=max(1,(pieces.map{$0.count}.max() ?? 0)+299)/300
            for segment in 0..<max(1,segments) {
                let cells=pieces.map { chars -> String in
                    let start=segment*300
                    return start>=chars.count ? "" : String(chars[start..<min(start+300,chars.count)])
                }
                let height=(zip(cells,widths).map{textHeight($0.0,$0.1-14,9.5)}.max() ?? 15)+14
                if y+height>H-50 {endPage();beginPage(true);drawRow(table.headers,widths,true)}
                drawRow(cells,widths,false,i%2==1)
            }
        }
    }
    endPage()
}
ctx.closePDF()
guard let verified=PDFDocument(url:output),verified.pageCount==page else {fatalError("PDF page count validation failed")}
let allText=(0..<page).compactMap{verified.page(at:$0)?.string}.joined(separator:"\n")
guard allText.contains("Керамогранит"),allText.contains("ПРЕДВАРИТЕЛЬНО") else {fatalError("Missing PDF text")}
if args.count>3 {
    let dir=URL(fileURLWithPath:args[3]);try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
    // Retire only excess page thumbnails from a previous, longer generated release.
    for file in try FileManager.default.contentsOfDirectory(at:dir,includingPropertiesForKeys:nil) {
        let name=file.lastPathComponent
        if name.range(of:"^page-[0-9]+\\.png$",options:.regularExpression) != nil,
           let index=Int(name.dropFirst(5).dropLast(4)), index>page {
            try FileManager.default.removeItem(at:file)
        }
    }
    for index in 0..<page {
        let thumbnail=verified.page(at:index)!.thumbnail(of:NSSize(width:1263,height:893),for:.mediaBox)
        let rep=NSBitmapImageRep(data:thumbnail.tiffRepresentation!)!
        try rep.representation(using:.png,properties:[:])!.write(to:dir.appendingPathComponent(String(format:"page-%03d.png",index+1)))
    }
    try allText.write(to:dir.appendingPathComponent("text.txt"),atomically:true,encoding:.utf8)
}
print("PDF written: \(output.path) (\(page) pages; selectable text and vector diagrams verified)")
