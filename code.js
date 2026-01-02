// если в названии есть [exclude] - не работает со слоем
// все FRAME обрабатываются как контейнеры (рекурсивно)

// Динамические настройки (загружаются из UI)
var SCALE = 1;
var target_project = { width: 1080, height: 1920 };
var target_project_fonts = [
    { name: "font_bold", fontPath: "/assets/fonts/font_bold.font" },
    { name: "font_regular", fontPath: "/assets/fonts/font_regular.font" },
];
var is_use_background_node = true;
var max_font_scale = 60;
var apiKey = "";
var languages = "en,ru,de,fr,es,pt,ko,ja";
var useDruid = true;
var googleSheetUrl = "";
var autoTranslate = false;

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) { function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); } return new (P || (P = Promise))(function (resolve, reject) { function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } } function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } } function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); } step((generator = generator.apply(thisArg, _arguments || [])).next()); }); };

var frame_name = "";
var all_atlas_images = [];
var atlasContent = '';
var guiContent = '';
var scriptContent = '';
var collectionContent = '';
var textsForTranslation = [];
var emptyContainerIds = new Set();
var templateGuiFiles = []; // { name: string, content: string }
var processedComponentIds = new Set(); // Track unique components to avoid duplicate templates
var exportedComponentIds = new Set(); // Track exported component images to avoid duplicates
var addedHiddenTemplates = new Set(); // Track which templates are already added hidden on scene
var instanceDataForClone = []; // { templateName, instanceId, x, y, textContent } for code generation
var layoutContainers = new Map(); // Store AutoLayout frame data: { id, mode, margin, padding }

// Check if a node is an empty container (no visible fills AND no visible strokes)
function isEmptyContainer(node) {
    // Check for visible strokes
    var hasVisibleStroke = node.strokes && node.strokes.length > 0 && 
        node.strokes.some(stroke => stroke.visible !== false);
    if (hasVisibleStroke) return false;
    
    // Check for visible fills
    if (!node.fills || node.fills.length === 0) return true;
    return node.fills.every(fill => 
        fill.visible === false || 
        (fill.type === 'SOLID' && (fill.opacity === 0 || (fill.color && fill.color.a === 0)))
    );
}

// 1x1 transparent PNG as raw bytes (validated, atob not available in Figma sandbox)
function getEmptyPlaceholderImage() {
    // Valid 1x1 transparent PNG
    return new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk length + type
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // width=1, height=1
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, // bit depth, color type, compression, filter, interlace + CRC
        0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, // IDAT chunk length + type
        0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, // compressed data + CRC
        0x0D, 0x0A, 0x2D, 0xB4,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND chunk
        0xAE, 0x42, 0x60, 0x82  // IEND CRC
    ]);
}
function updateExportSettings() {
    return {
        format: "PNG",
        constraint: { type: "SCALE", value: SCALE }
    };
}
var exportSettings = updateExportSettings();

// Compare fills between instance and mainComponent
function fillsAreDifferent(instanceNode, mainComponent) {
    if (!instanceNode || !mainComponent) return false;
    
    // Get fills from both
    var instanceFills = instanceNode.fills || [];
    var componentFills = mainComponent.fills || [];
    
    // If different number of fills
    if (instanceFills.length !== componentFills.length) return true;
    
    // Compare each fill
    for (var i = 0; i < instanceFills.length; i++) {
        var iFill = instanceFills[i];
        var cFill = componentFills[i];
        
        // Compare type
        if (iFill.type !== cFill.type) return true;
        
        // Compare color if solid
        if (iFill.type === 'SOLID' && cFill.type === 'SOLID') {
            if (!iFill.color || !cFill.color) return true;
            if (Math.abs(iFill.color.r - cFill.color.r) > 0.01) return true;
            if (Math.abs(iFill.color.g - cFill.color.g) > 0.01) return true;
            if (Math.abs(iFill.color.b - cFill.color.b) > 0.01) return true;
        }
        
        // Compare opacity
        var iOpacity = iFill.opacity !== undefined ? iFill.opacity : 1;
        var cOpacity = cFill.opacity !== undefined ? cFill.opacity : 1;
        if (Math.abs(iOpacity - cOpacity) > 0.01) return true;
    }
    
    return false;
}

// Экспортируем слои как PNG изображения
async function exportLayer(node) {
    let originalSizes = {};

    for (let child of node.children) {

        if (child.type !== "TEXT" && child.name !== "[exclude]") {
            try {
                // Helper: Recursive check if node contains ANY layout elements (FRAME, INSTANCE, SECTION, TEXT)
                // This determines if a container should be treated as a Layout (recurse) or Visual Asset (bake)
                // Groups are traversed transparently to see what's inside.
                function hasLayoutChildren(node) {
                    if (!node.children) return false;
                    return node.children.some(c => {
                        // Added TEXT here - if a frame contains Text, it's a layout (e.g. Button)
                        // We want to separate the Text from the Background.
                        if (c.type === 'FRAME' || c.type === 'INSTANCE' || c.type === 'SECTION' || c.type === 'TEXT') return true;
                        if (c.type === 'GROUP') return hasLayoutChildren(c);
                        return false;
                    });
                }

                // Helper: Recursive check if node contains ANY visual elements that should be baked
                function hasVisualChildren(node) {
                    if (!node.children) return false;
                    return node.children.some(c => {
                         if (!c.visible) return false;
                         if (c.type === 'GROUP') return hasVisualChildren(c);
                         return ['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'LINE', 'BOOLEAN_OPERATION', 'TEXT'].includes(c.type);
                    });
                }
                
                // Helper: Smart hide - hides only Layout Elements (Frame, Instance, Text) to prepare for baking background.
                // Keeps primitives visible so they merge into the background image.
                // Returns array of hidden elements to restore later.
                function hideLayoutElements(container) {
                    let hidden = [];
                    
                    function process(node) {
                        if (!node.children) return;
                        for (let c of node.children) {
                            // If element is already hidden, skip
                            if (!c.visible) continue;
                            
                            const isLayoutElement = c.type === 'FRAME' || c.type === 'INSTANCE' || c.type === 'SECTION' || c.type === 'TEXT';
                            
                            if (isLayoutElement) {
                                c.visible = false;
                                hidden.push(c);
                            } else if (c.type === 'GROUP') {
                                // For groups, we dig deeper to hide layout items inside, but keep the group itself visible
                                // (unless the group itself needs hiding logic, but usually group is just a pass-through)
                                process(c);
                            }
                            // Primitives are left visible!
                        }
                    }
                    process(container);
                    return hidden;
                }
                
                // Determine if this is a Layout Container or a Visual Asset
                const isLayout = hasLayoutChildren(child);
                const hasVisuals = hasVisualChildren(child);
                const isEmpty = isEmptyContainer(child);
                
                // --- HANDLING FOR GROUPS ---
                if (child.type === "GROUP") {
                    if (child.children && child.children.length > 0) {
                        await exportLayer(child);
                    }
                    continue; 
                }

                // --- HANDLING FOR FRAMES ---
                if (child.type === "FRAME") {
                    // 1. EMPTY CONTAINER (Layout or Spacer)
                    if (isEmpty && (isLayout || !hasVisuals)) {
                        emptyContainerIds.add(child.id);
                        if (child.children && child.children.length > 0) {
                            await exportLayer(child);
                        }
                        continue; 
                    }

                    // 2. LAYOUT CONTAINER WITH BACKGROUND
                    let hiddenElements = [];
                    if (isLayout) {
                        // Smart hide: Hide Text/Frames, keep Shapes
                        hiddenElements = hideLayoutElements(child);
                    }
                    
                    // 3. EXPORT IMAGE (Background + Shapes)
                    // -- EXPORT SECTION --
                    if (child.name.includes("[corner]")) {
                        originalSizes[child.id] = { width: child.width, height: child.height };
                        const newSize = child.cornerRadius * 2;
                        child.resize(newSize, newSize);
                    }

                    const value = await child.exportAsync(exportSettings);
                    const fileName = child.name.replace(/\[corner\]/g, "") + ".png";
                    all_atlas_images.push({
                        name: fileName,
                        value: value,
                    });

                    if (child.name.includes("[corner]")) {
                        child.resize(originalSizes[child.id].width, originalSizes[child.id].height);
                    }
                    // -- END EXPORT SECTION --

                    // Restore & Recurse (for layouts)
                    if (isLayout) {
                        // Restore visibility
                        for (let el of hiddenElements) {
                            el.visible = true;
                        }
                        // Recurse to components inside
                        await exportLayer(child);
                    }
                } // End FRAME handling
                
                
                // --- HANDLING FOR INSTANCES ---
                if (child.type === "INSTANCE" && child.mainComponent) {
                    console.log('[INSTANCE EXPORT]', child.name, 'component:', child.mainComponent.name);
                    const componentId = child.mainComponent.id;
                    const componentName = child.mainComponent.name.replace(/\[.*?\]/g, '').trim();
                    const instanceName = child.name;
                    const instanceId = instanceName.replace(/\[.*?\]/g, '').trim();
                    
                    const isEmptyInstance = isEmptyContainer(child);
                    
                    let hiddenChildren = [];
                    let originalSize = null;
                    
                    try {
                        // 1. EMPTY CONTAINER (Layout or Spacer)
                        if (isEmptyInstance && (isLayout || !hasVisuals)) {
                            console.log('[INSTANCE EMPTY]', child.name, '- skipping image export');
                            emptyContainerIds.add(child.id);
                        } 
                        // 2. EXPORT INSTANCE IMAGE
                        else {
                            // Check if fills are different from mainComponent
                            const isDifferent = fillsAreDifferent(child, child.mainComponent);
                            
                            // Smart hide for layouts
                            if (isLayout) {
                                hiddenChildren = hideLayoutElements(child);
                            }
                            
                            // Apply [corner] logic - resize to corner radius
                            if (instanceName.includes("[corner]") && child.cornerRadius) {
                                originalSize = { width: child.width, height: child.height };
                                const newSize = child.cornerRadius * 2;
                                child.resize(newSize, newSize);
                            }
                            
                            // Export base component texture only once
                            if (!exportedComponentIds.has(componentId)) {
                                const value = await child.exportAsync(exportSettings);
                                all_atlas_images.push({
                                    name: componentName + '.png',
                                    value: value,
                                });
                                exportedComponentIds.add(componentId); // Mark as exported
                            }
                            
                            // If instance has different fills, export with unique name
                            if (isDifferent && instanceId !== componentName) {
                                const value = await child.exportAsync(exportSettings);
                                all_atlas_images.push({
                                    name: instanceId + '.png',
                                    value: value,
                                });
                            }
                        }
                    } catch (err) {
                        console.error("Error exporting INSTANCE texture:", err);
                    } finally {
                        // Always restore [corner] size
                        if (originalSize) {
                            child.resize(originalSize.width, originalSize.height);
                        }
                        
                        // Restore children visibility
                        for (let el of hiddenChildren) {
                            el.visible = true;
                        }
                    }
                    
                    // Only recurse if it's a Layout.
                    if (isLayout && child.children && child.children.length > 0) {
                        console.log('[INSTANCE RECURSE]', child.name, 'is Layout, recursing into', child.children.length, 'children');
                        await exportLayer(child);
                    }
                }
            } catch (error) {
                console.error("Ошибка при экспорте слоя:", error, "Слой:", child);
            }
        }
    }
}

// Экспортируем слои как PNG изображения
async function exportLayersToPNG(selection) {
    try {
        for (const node of selection) {
            if (node.type === "FRAME") {
                // Дать имя архиву
                frame_name = node.name;

                if (node.children) {
                    await exportLayer(node);
                }
            }
        }

        setTimeout(() => {
            createAtlasFile(selection);
        }, 1000);
    } catch (error) {
        console.error("Ошибка при экспорте слоев:", error);
    }
}

// Создаем .atlas файл и заполняем его содержимым
// нам нужен архив во всеми созданными файлами
function createAtlasFile(selection) {
    // Add placeholder image for empty containers if needed
    if (emptyContainerIds.size > 0) {
        all_atlas_images.push({
            name: 'avoid_node_empty.png',
            value: getEmptyPlaceholderImage(),
        });
    }

    for (const data of all_atlas_images) {
        var imagePath = '/assets/' + frame_name + '/images/' + data.name;
        atlasContent += 'images {\n';
        atlasContent += '  image: "' + imagePath + '"\n';
        atlasContent += '  sprite_trim_mode: SPRITE_TRIM_MODE_OFF\n';
        atlasContent += '}\n';
    }

    // Продолжите добавление строк в atlasContent вместо atlasFile.writeln()
    atlasContent += 'margin: 0\n';
    atlasContent += 'extrude_borders: 2\n';
    atlasContent += 'inner_padding: 0\n';

    setTimeout(() => {
        createGUIFile(selection);
    }, 0);
}

// Создаем .gui файл
function createGUIFile(selection) {

    guiContent += 'script: "/assets/' + frame_name + '/' + frame_name + '.gui_script"\n';

    for (var i = 0; i < target_project_fonts.length; i++) {
        var font = target_project_fonts[i];
        guiContent += 'fonts {\n';
        guiContent += '  name: "' + font.name + '"\n';
        guiContent += '  font: "' + font.fontPath + '"\n';
        guiContent += '}\n';
    }

    guiContent += 'textures {\n';
    guiContent += '  name: "' + frame_name + '"\n';
    guiContent += '  texture: "/assets/' + frame_name + '/' + frame_name + '.atlas"\n';
    guiContent += '}\n';



    if (is_use_background_node) {
        var position_x = (target_project.width / 2) * SCALE;
        var position_y = (target_project.height / 2) * SCALE;

        guiContent += 'nodes {\n';
        guiContent += '  position {\n';
        guiContent += '    x: ' + position_x + '\n';
        guiContent += '    y: ' + position_y + '\n';
        guiContent += '  }\n';
        guiContent += '  type: TYPE_BOX\n';
        guiContent += '  texture: ""\n';
        guiContent += '  id: "background"\n';
        guiContent += '  inherit_alpha: true\n';
        guiContent += '  size_mode: SIZE_MODE_MANUAL\n';
        guiContent += '}\n';
    }

    for (const node of selection) {
        if (node.type === "FRAME") {

            let parent_name = ""
            if (is_use_background_node) {
                parent_name = 'background';
            }

            parseNodeOfTree(node, parent_name);
        }
    }
    guiContent += 'layers {\n';
    guiContent += '   name: "text"\n';
    guiContent += '}\n';
    guiContent += 'material: "/builtins/materials/gui.material"\n';
    guiContent += 'adjust_reference: ADJUST_REFERENCE_PARENT\n';
    guiContent += 'max_nodes: 1024\n';

    createCollectionContent(selection)
    createScriptFile(selection);
}

var frameWidth = 0
var frameHeight = 0
var offsetX = 0
var offsetY = 0

function parseNodeOfTree(node, parent_name) {
    // Collect AutoLayout properties for the container node
    if (parent_name && (node.layoutMode === "VERTICAL" || node.layoutMode === "HORIZONTAL")) {
        layoutContainers.set(parent_name, {
            mode: node.layoutMode.toLowerCase(),
            isWrap: node.layoutWrap === "WRAP",
            margin: node.itemSpacing || 0,
            padding: {
                top: node.paddingTop || 0,
                bottom: node.paddingBottom || 0,
                left: node.paddingLeft || 0,
                right: node.paddingRight || 0
            }
        });
    }

    if (!node.children) {
        return;
    }

    for (let child of node.children) {
        if (child.name != "[exclude]") {
            var layerName = child.name.replace(/\[corner\]/g, "");
            var layerPosition = {
                x: child.x,
                y: child.y
            };

            frameWidth = node.width;
            frameHeight = node.height;

            offsetX = ((target_project.width - frameWidth) / 2) * SCALE;
            offsetY = ((target_project.height - frameHeight) / 2) * SCALE;

            layerPosition.x = layerPosition.x * SCALE + offsetX;
            layerPosition.y = (frameHeight - layerPosition.y) * SCALE + offsetY;

            layerPosition.x += child.width / 2
            layerPosition.y -= child.height / 2

            if (is_use_background_node) {
                var offset_x = (target_project.width / 2) * SCALE;
                var offset_y = (target_project.height / 2) * SCALE;
                layerPosition.x -= offset_x;
                layerPosition.y -= offset_y;
            }

            // Handle INSTANCE nodes - add hidden template once, collect data for code clone
            if (child.type === "INSTANCE") {
                createTemplateGui(child);
                
                var templateName = (child.mainComponent ? child.mainComponent.name : child.name).replace(/\[.*?\]/g, '').trim();
                var instanceId = child.name.replace(/\[.*?\]/g, '').trim();
                
                // Add hidden template node only once per unique template
                if (!addedHiddenTemplates.has(templateName)) {
                    addedHiddenTemplates.add(templateName);
                    
                    guiContent += 'nodes {\n';
                    guiContent += '  position {\n';
                    guiContent += '    x: 0.0\n';
                    guiContent += '    y: -2105.0\n';
                    guiContent += '  }\n';
                    guiContent += '  scale {\n';
                    guiContent += '    x: 1.0\n';
                    guiContent += '    y: 1.0\n';
                    guiContent += '    z: 1.0\n';
                    guiContent += '    w: 1.0\n';
                    guiContent += '  }\n';
                    guiContent += '  type: TYPE_TEMPLATE\n';
                    guiContent += '  id: "' + templateName + '"\n';
                    guiContent += '  inherit_alpha: true\n';
                    guiContent += '  alpha: 1.0\n';
                    guiContent += '  template: "/assets/' + frame_name + '/templates/' + templateName + '.gui"\n';
                    guiContent += '  enabled: false\n';
                    if (parent_name) {
                        guiContent += '  parent: "' + parent_name + '"\n';
                    }
                    guiContent += '}\n';
                }
                
                // Collect instance data for code generation (clone_tree)
                var textContent = '';
                if (child.children) {
                    for (let grandchild of child.children) {
                        if (grandchild.type === 'TEXT') {
                            textContent = grandchild.characters;
                            break;
                        }
                    }
                }
                
                instanceDataForClone.push({
                    templateName: templateName,
                    instanceId: instanceId,
                    x: layerPosition.x,
                    y: layerPosition.y,
                    textContent: textContent,
                    parentName: parent_name || '',
                    hasCustomTexture: fillsAreDifferent(child, child.mainComponent) && instanceId !== templateName
                });
                
                continue; // Skip regular node creation - will be cloned from code
            }

            // Skip primitive shapes - they're exported as part of parent FRAME image
            const primitiveTypes = ['ELLIPSE', 'RECTANGLE', 'POLYGON', 'STAR', 'VECTOR', 'LINE', 'BOOLEAN_OPERATION'];
            if (primitiveTypes.includes(child.type)) {
                continue; // Don't create separate node for shapes
            }

            if (child.type === "TEXT") {
                // Корректировка позиции для разных pivot (LEFT/RIGHT)
                let horizontalAlignment = child.textAlignHorizontal;
                if (horizontalAlignment === "LEFT") {
                    layerPosition.x -= child.width / 2;
                } else if (horizontalAlignment === "RIGHT") {
                    layerPosition.x += child.width / 2;
                }
            }

            guiContent += 'nodes {\n';
            guiContent += '  position {\n';
            guiContent += '    x: ' + layerPosition.x + '\n';
            guiContent += '    y: ' + layerPosition.y + '\n';
            guiContent += '  }\n';
        }

        if (child.type === "TEXT") {
            var textSize = child.fontSize;
            var text_scale = textSize / max_font_scale;

            var textWidth = child.width / text_scale;
            var textHeight = child.height / text_scale;

            guiContent += '  size {\n';
            guiContent += '    x: ' + textWidth.toFixed(2) + '\n';
            guiContent += '    y: ' + textHeight.toFixed(2) + '\n';
            guiContent += '    z: 0.0\n';
            guiContent += '    w: 1.0\n';
            guiContent += '  }\n';

            var textContent = child.characters;

            // Проверяем наличие символа новой строки для определения многострочности
            //const isMultiline = textContent.includes("\n");

            // Проверяем, является ли текст многострочным
            //const isMultiline = child.height > child.fontSize;

            const lineCount = child.height / child.fontSize;

            // Проверяем, является ли текст многострочным
            const isMultiline = lineCount >= 2;

            // Получаем высоту текста в одной строке с учетом размера шрифта
            //const singleLineHeight = child.fontSize;

            // Вычисляем количество строк текста, разделив высоту текстового поля на высоту текста в одной строке
            //const lineCount = textBounds.height / singleLineHeight;

            textContent = textContent.replace(/\n/g, "\\n");

            const fills = child.fills;
            const textColor = fills[0].color;
            var r = textColor.r;
            var g = textColor.g;
            var b = textColor.b;

            guiContent += '  color {\n';
            guiContent += '    x: ' + r.toFixed(2) + '\n';
            guiContent += '    y: ' + g.toFixed(2) + '\n';
            guiContent += '    z: ' + b.toFixed(2) + '\n';
            guiContent += '    w: 1.0\n';
            guiContent += '  }\n';
            guiContent += '  scale {\n';
            guiContent += '    x: ' + text_scale.toFixed(2) + '\n';
            guiContent += '    y: ' + text_scale.toFixed(2) + '\n';
            guiContent += '    z: 1.0\n';
            guiContent += '    w: 1.0\n';
            guiContent += '  }\n';
            guiContent += 'type: TYPE_TEXT\n';
            guiContent += 'blend_mode: BLEND_MODE_ALPHA\n';
            guiContent += 'text: "' + textContent + '"\n';

            console.log(child.fontWeight);

            if (child.fontWeight == 600) {
                guiContent += 'font: "font_bold"\n';
            } else {
                guiContent += 'font: "font_regular"\n';
            }
            console.log(layerName);
            guiContent += 'id: "' + layerName + '"\n';
            guiContent += 'xanchor: XANCHOR_NONE\n';
            guiContent += 'yanchor: YANCHOR_NONE\n';

            // Определяем значение pivot в зависимости от горизонтального выравнивания
            let horizontalAlignment = child.textAlignHorizontal;
            let pivot;
            if (horizontalAlignment === "CENTER") {
                pivot = "PIVOT_CENTER";
            } else if (horizontalAlignment === "LEFT") {
                pivot = "PIVOT_W";
            } else if (horizontalAlignment === "RIGHT") {
                pivot = "PIVOT_E";
            }

            // Добавляем значение pivot в guiContent
            guiContent += `pivot: ${pivot}\n`;

            guiContent += 'adjust_mode: ADJUST_MODE_FIT\n';

            if (isMultiline) {
                guiContent += 'line_break: true\n';
            } else {
                guiContent += 'line_break: false\n';
            }

            guiContent += 'layer: "text"\n';
            guiContent += 'inherit_alpha: true\n';
            guiContent += 'alpha: 1.0\n';
            // Check if text has visible strokes
            var hasStroke = child.strokes && child.strokes.length > 0 && child.strokes.some(s => s.visible !== false);
            guiContent += 'outline_alpha: ' + (hasStroke ? '1.0' : '0.0') + '\n';
            guiContent += 'template_node_child: false\n';
            guiContent += 'text_leading: 1.1\n';
            guiContent += 'text_tracking: 0.0\n';
            guiContent += 'custom_type: 0\n';
            guiContent += 'enabled: true\n';
            guiContent += 'visible: true\n';
            guiContent += 'material: ""\n';
        } else {
            guiContent += '  scale {\n';
            guiContent += '    x: ' + SCALE + '\n';
            guiContent += '    y: ' + SCALE + '\n';
            guiContent += '    z: 1.0\n';
            guiContent += '     w: 1.0\n';
            guiContent += '  }\n';

            // Determine if this is an empty container
            var isEmptyNode = emptyContainerIds.has(child.id);

            // Size block - always set manual size for empty containers and [corner] nodes
            if (child.name.includes("[corner]") || isEmptyNode) {
                let size_width = child.width;
                let size_height = child.height;
                // Check for drop shadow effects
                if (child.effects && child.effects.length > 0) {
                    for (let effect of child.effects) {
                        if (effect.type === "DROP_SHADOW") {
                            size_width += effect.radius * 2;
                            size_height += effect.radius * 2;
                        }
                    }
                }

                guiContent += '  size {\n';
                guiContent += '    x: ' + size_width + '\n';
                guiContent += '    y: ' + size_height + '\n';
                guiContent += '    z: 0.0\n';
                guiContent += '    w: 1.0\n';
            } else {
                guiContent += '  size {\n';
                guiContent += '    x: 200.0\n';
                guiContent += '    y: 100.0\n';
                guiContent += '    z: 0.0\n';
                guiContent += '    w: 1.0\n';
            }

            guiContent += '  }\n';
            guiContent += '  color {\n';
            guiContent += '    x: 1.0\n';
            guiContent += '    y: 1.0\n';
            guiContent += '    z: 1.0\n';
            guiContent += '    w: 1.0\n';
            guiContent += '  }\n';
            guiContent += '  type: TYPE_BOX\n';
            guiContent += '  blend_mode: BLEND_MODE_ALPHA\n';
            // Use placeholder texture for empty containers
            if (isEmptyNode) {
                guiContent += '  texture: "' + frame_name + '/avoid_node_empty"\n';
            } else {
                guiContent += '  texture: "' + frame_name + '/' + layerName + '"\n';
            }
            guiContent += '  id: "' + layerName + '"\n';
            guiContent += '  xanchor: XANCHOR_NONE\n';
            guiContent += ' yanchor: YANCHOR_NONE\n';
            guiContent += '  pivot: PIVOT_CENTER\n';
            if (isEmptyNode) {
                 guiContent += ' adjust_mode: ADJUST_MODE_STRETCH\n';
            } else {
                 guiContent += ' adjust_mode: ADJUST_MODE_FIT\n';
            }
            guiContent += '  layer: ""\n';
            guiContent += '  inherit_alpha: true\n';

            if (child.name.includes("[corner]")) {

                let cornerRadius = child.cornerRadius// + 5
                // если у объекта есть тень
                // TODO сделать поддержку тени со смещением
                if (child.effects && child.effects.length > 0) {
                    for (let effect of child.effects) {
                        if (effect.type === "DROP_SHADOW") {
                            cornerRadius += effect.radius
                        }
                    }
                }

                guiContent += '  slice9 {\n';
                guiContent += '    x: ' + cornerRadius + '\n';
                guiContent += '    y: ' + cornerRadius + '\n';
                guiContent += '    z: ' + cornerRadius + '\n';
                guiContent += '    w: ' + cornerRadius + '\n';

            } else {
                guiContent += '  slice9 {\n';
                guiContent += '    x: 0.0\n';
                guiContent += '    y: 0.0\n';
                guiContent += '    z: 0.0\n';
                guiContent += '    w: 0.0\n';
            }

            guiContent += '  }\n';
            guiContent += '  clipping_mode: CLIPPING_MODE_NONE\n';
            guiContent += '  clipping_visible: true\n';
            guiContent += '  clipping_inverted: false\n';
            guiContent += '  alpha: 1.0\n';
            guiContent += '  template_node_child: false\n';

            if (child.name.includes("[corner]") || isEmptyNode) {
                guiContent += '  size_mode: SIZE_MODE_MANUAL\n';
            } else {
                guiContent += '  size_mode: SIZE_MODE_AUTO\n';
            }
            guiContent += '  custom_type: 0\n';
            guiContent += '  enabled: true\n';
            guiContent += '  visible: true\n';
            guiContent += '  material: ""\n';
        }

        if (parent_name) {
            guiContent += '  parent: "' + parent_name + '"\n';
        }

        guiContent += '}\n';

        // Если это FRAME - рекурсивно обработать детей
        if (child.type === "FRAME" && child.children) {
            parseNodeOfTree(child, layerName)
        }


    }
}

// Create template GUI file for INSTANCE nodes
function createTemplateGui(instanceNode) {
    // Get the main component ID to avoid duplicates
    var mainComponent = instanceNode.mainComponent;
    var componentId = mainComponent ? mainComponent.id : instanceNode.id;
    
    // Skip if we already processed this component
    if (processedComponentIds.has(componentId)) {
        return;
    }
    processedComponentIds.add(componentId);
    
    // Helper: Recursive check if node contains ANY layout elements
    function hasLayoutChildren(node) {
        if (!node.children) return false;
        return node.children.some(c => {
            if (c.type === 'FRAME' || c.type === 'INSTANCE' || c.type === 'SECTION' || c.type === 'TEXT') return true;
            if (c.type === 'GROUP') return hasLayoutChildren(c);
            return false;
        });
    }

    // Helper: Recursive check if node contains ANY visual elements
    function hasVisualChildren(node) {
        if (!node.children) return false;
        return node.children.some(c => {
             if (!c.visible) return false;
             if (c.type === 'GROUP') return hasVisualChildren(c);
             return ['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'LINE', 'BOOLEAN_OPERATION', 'TEXT'].includes(c.type);
        });
    }

    // Determine if this component root is an Empty Layout/Spacer
    // We check the INSTANCE node itself (because it represents the component usage)
    const isLayout = hasLayoutChildren(instanceNode);
    const hasVisuals = hasVisualChildren(instanceNode);
    const isEmpty = isEmptyContainer(instanceNode);
    // If it's an Empty Layout OR an Empty Spacer (no visuals), use avoid_node
    const shouldAvoid = isEmpty && (isLayout || !hasVisuals);

    
    // Use mainComponent for naming, instanceNode for dimensions
    var sourceNode = mainComponent || instanceNode;
    var templateName = sourceNode.name.replace(/\[.*?\]/g, '').trim();
    var instanceName = instanceNode.name;
    var isCorner = instanceName.includes("[corner]");
    var cornerRadius = instanceNode.cornerRadius || 0;
    
    var templateContent = '';
    
    // Add fonts
    for (var i = 0; i < target_project_fonts.length; i++) {
        var font = target_project_fonts[i];
        templateContent += 'fonts {\n';
        templateContent += '  name: "' + font.name + '"\n';
        templateContent += '  font: "' + font.fontPath + '"\n';
        templateContent += '}\n';
    }
    
    // Reference main texture (parent atlas)
    templateContent += 'textures {\n';
    templateContent += '  name: "' + frame_name + '"\n';
    templateContent += '  texture: "/assets/' + frame_name + '/' + frame_name + '.atlas"\n';
    templateContent += '}\n';
    
    // Create root node for the template (the component wrapper)
    // Use instanceNode dimensions (original size before corner crop)
    var nodesContent = '';
    nodesContent += 'nodes {\n';
    nodesContent += '  position {\n';
    nodesContent += '    x: 0.0\n';
    nodesContent += '    y: 0.0\n';
    nodesContent += '  }\n';
    nodesContent += '  scale {\n';
    nodesContent += '    x: ' + SCALE + '\n';
    nodesContent += '    y: ' + SCALE + '\n';
    nodesContent += '    z: 1.0\n';
    nodesContent += '    w: 1.0\n';
    nodesContent += '  }\n';
    nodesContent += '  size {\n';
    nodesContent += '    x: ' + instanceNode.width + '\n';
    nodesContent += '    y: ' + instanceNode.height + '\n';
    nodesContent += '    z: 0.0\n';
    nodesContent += '    w: 1.0\n';
    nodesContent += '  }\n';
    nodesContent += '  color {\n';
    nodesContent += '    x: 1.0\n';
    nodesContent += '    y: 1.0\n';
    nodesContent += '    z: 1.0\n';
    nodesContent += '    w: 1.0\n';
    nodesContent += '  }\n';
    nodesContent += '  type: TYPE_BOX\n';
    nodesContent += '  blend_mode: BLEND_MODE_ALPHA\n';
    
    if (shouldAvoid) {
        nodesContent += '  texture: "' + frame_name + '/avoid_node_empty"\n';
    } else {
        nodesContent += '  texture: "' + frame_name + '/' + templateName + '"\n';
    }
    
    nodesContent += '  id: "' + templateName + '"\n';
    nodesContent += '  xanchor: XANCHOR_NONE\n';
    nodesContent += '  yanchor: YANCHOR_NONE\n';
    nodesContent += '  pivot: PIVOT_CENTER\n';
    
    if (shouldAvoid) {
        nodesContent += '  adjust_mode: ADJUST_MODE_STRETCH\n';
    } else {
        nodesContent += '  adjust_mode: ADJUST_MODE_FIT\n';
    }
    nodesContent += '  layer: ""\n';
    nodesContent += '  inherit_alpha: true\n';
    
    // Add slice9 based on cornerRadius for [corner] nodes
    if (isCorner && cornerRadius > 0) {
        nodesContent += '  slice9 {\n';
        nodesContent += '    x: ' + cornerRadius + '\n';
        nodesContent += '    y: ' + cornerRadius + '\n';
        nodesContent += '    z: ' + cornerRadius + '\n';
        nodesContent += '    w: ' + cornerRadius + '\n';
        nodesContent += '  }\n';
    } else {
        nodesContent += '  slice9 {\n';
        nodesContent += '    x: 0.0\n';
        nodesContent += '    y: 0.0\n';
        nodesContent += '    z: 0.0\n';
        nodesContent += '    w: 0.0\n';
        nodesContent += '  }\n';
    }
    
    nodesContent += '  clipping_mode: CLIPPING_MODE_NONE\n';
    nodesContent += '  clipping_visible: true\n';
    nodesContent += '  clipping_inverted: false\n';
    nodesContent += '  alpha: 1.0\n';
    nodesContent += '  template_node_child: false\n';
    
    // Use SIZE_MODE_MANUAL for corner nodes OR empty layouts so size works
    if (isCorner || shouldAvoid) {
        nodesContent += '  size_mode: SIZE_MODE_MANUAL\n';
    } else {
        nodesContent += '  size_mode: SIZE_MODE_AUTO\n';
    }
    
    nodesContent += '  custom_type: 0\n';
    nodesContent += '  enabled: true\n';
    nodesContent += '  visible: true\n';
    nodesContent += '  material: ""\n';
    nodesContent += '}\n';
    
    // Parse children - pass instanceNode for correct positioning
    if (instanceNode.children) {
        nodesContent += parseTemplateNodes(instanceNode, templateName, instanceNode);
    }
    
    templateContent += nodesContent;
    templateContent += 'layers {\n';
    templateContent += '   name: "text"\n';
    templateContent += '}\n';
    templateContent += 'material: "/builtins/materials/gui.material"\n';
    templateContent += 'adjust_reference: ADJUST_REFERENCE_PARENT\n';
    templateContent += 'max_nodes: 512\n';
    
    templateGuiFiles.push({
        name: templateName + '.gui',
        content: templateContent
    });
}

// Parse template instance nodes recursively
function parseTemplateNodes(node, parent_name, rootNode) {
    if (!node.children) {
        return '';
    }
    
    var result = '';
    
    for (let child of node.children) {
        if (child.name != "[exclude]") {
            var layerName = child.name.replace(/\[corner\]/g, "");
            
            // Skip primitive shapes - they're exported as part of parent FRAME image
            const primitiveTypes = ['ELLIPSE', 'RECTANGLE', 'POLYGON', 'STAR', 'VECTOR', 'LINE', 'BOOLEAN_OPERATION'];
            if (primitiveTypes.includes(child.type)) {
                continue; // Don't create separate node for shapes
            }

            // Determine Pivot and Anchor Point based on Text Alignment
            // Default to Center (for Boxes)
            let hAlign = 'CENTER';
            let vAlign = 'CENTER';
            
            if (child.type === 'TEXT') {
                hAlign = child.textAlignHorizontal || 'CENTER';
                vAlign = child.textAlignVertical || 'CENTER';
                if (hAlign === 'JUSTIFIED') hAlign = 'LEFT'; // Fallback
            }

            // Calculate Anchor Point (in Parent Local Space) based on alignment
            let anchorX = child.x + child.width / 2;
            let anchorY = child.y + child.height / 2;
            let pivotName = 'PIVOT_CENTER';

            // Horizontal Logic
            let suffixH = '';
            if (hAlign === 'LEFT') {
                anchorX = child.x;
                suffixH = 'W';
            } else if (hAlign === 'RIGHT') {
                anchorX = child.x + child.width;
                suffixH = 'E';
            }

            // Vertical Logic
            let suffixV = '';
            if (vAlign === 'TOP') {
                anchorY = child.y;
                suffixV = 'N';
            } else if (vAlign === 'BOTTOM') {
                anchorY = child.y + child.height;
                suffixV = 'S';
            }

            // Construct Pivot Name (e.g. PIVOT_NW, PIVOT_N, PIVOT_W, PIVOT_CENTER)
            if (suffixV === '' && suffixH === '') {
                pivotName = 'PIVOT_CENTER';
            } else {
                pivotName = 'PIVOT_' + suffixV + suffixH;
            }

            // Correct combinations like PIVOT_N (Top-Center) -> suffixH is empty
            // PIVOT_W (Center-Left) -> suffixV is empty
            
            // Calculate Position relative to Parent CENTER
            var parentCenterX = rootNode.width / 2;
            var parentCenterY = rootNode.height / 2;
            
            // posX: offset from parent center
            // posY: offset from parent center (Y flipped)
            var posX = anchorX - parentCenterX;
            var posY = parentCenterY - anchorY;
            
            
            var nodeContent = 'nodes {\n';
            nodeContent += '  position {\n';
            nodeContent += '    x: ' + posX + '\n';
            nodeContent += '    y: ' + posY + '\n';
            nodeContent += '  }\n';
            
            if (child.type === "TEXT") {
                var textSize = child.fontSize;
                var text_scale = textSize / max_font_scale;
                var textWidth = child.width / text_scale;
                var textHeight = child.height / text_scale;
                var textContent = child.characters.replace(/\n/g, "\\n");
                
                const fills = child.fills;
                var r = 1.0, g = 1.0, b = 1.0;
                if (fills && fills.length > 0 && fills[0].color) {
                    r = fills[0].color.r;
                    g = fills[0].color.g;
                    b = fills[0].color.b;
                }
                
                nodeContent += '  size {\n';
                nodeContent += '    x: ' + textWidth.toFixed(2) + '\n';
                nodeContent += '    y: ' + textHeight.toFixed(2) + '\n';
                nodeContent += '    z: 0.0\n';
                nodeContent += '    w: 1.0\n';
                nodeContent += '  }\n';
                nodeContent += '  color {\n';
                nodeContent += '    x: ' + r.toFixed(2) + '\n';
                nodeContent += '    y: ' + g.toFixed(2) + '\n';
                nodeContent += '    z: ' + b.toFixed(2) + '\n';
                nodeContent += '    w: 1.0\n';
                nodeContent += '  }\n';
                nodeContent += '  scale {\n';
                nodeContent += '    x: ' + text_scale.toFixed(2) + '\n';
                nodeContent += '    y: ' + text_scale.toFixed(2) + '\n';
                nodeContent += '    z: 1.0\n';
                nodeContent += '    w: 1.0\n';
                nodeContent += '  }\n';
                nodeContent += '  type: TYPE_TEXT\n';
                nodeContent += '  blend_mode: BLEND_MODE_ALPHA\n';
                nodeContent += '  text: "' + textContent + '"\n';
                nodeContent += '  font: "' + (child.fontWeight == 600 ? 'font_bold' : 'font_regular') + '"\n';
                nodeContent += '  id: "text"\n';
                nodeContent += '  xanchor: XANCHOR_NONE\n';
                nodeContent += '  yanchor: YANCHOR_NONE\n';
                nodeContent += '  pivot: ' + pivotName + '\n';
                nodeContent += '  adjust_mode: ADJUST_MODE_FIT\n';
                nodeContent += '  line_break: false\n';
                nodeContent += '  layer: "text"\n';
                nodeContent += '  inherit_alpha: true\n';
                nodeContent += '  alpha: 1.0\n';
                nodeContent += '  outline_alpha: 0.0\n';
                nodeContent += '  template_node_child: false\n';
                nodeContent += '  text_leading: 1.1\n';
                nodeContent += '  text_tracking: 0.0\n';
                nodeContent += '  custom_type: 0\n';
                nodeContent += '  enabled: true\n';
                nodeContent += '  visible: true\n';
                nodeContent += '  material: ""\n';
            } else {
                nodeContent += '  scale {\n';
                nodeContent += '    x: ' + SCALE + '\n';
                nodeContent += '    y: ' + SCALE + '\n';
                nodeContent += '    z: 1.0\n';
                nodeContent += '    w: 1.0\n';
                nodeContent += '  }\n';
                nodeContent += '  size {\n';
                nodeContent += '    x: 200.0\n';
                nodeContent += '    y: 100.0\n';
                nodeContent += '    z: 0.0\n';
                nodeContent += '    w: 1.0\n';
                nodeContent += '  }\n';
                nodeContent += '  color {\n';
                nodeContent += '    x: 1.0\n';
                nodeContent += '    y: 1.0\n';
                nodeContent += '    z: 1.0\n';
                nodeContent += '    w: 1.0\n';
                nodeContent += '  }\n';
                nodeContent += '  type: TYPE_BOX\n';
                nodeContent += '  blend_mode: BLEND_MODE_ALPHA\n';
                nodeContent += '  texture: "' + frame_name + '/' + layerName + '"\n';
                nodeContent += '  id: "' + layerName + '"\n';
                nodeContent += '  xanchor: XANCHOR_NONE\n';
                nodeContent += '  yanchor: YANCHOR_NONE\n';
                nodeContent += '  pivot: PIVOT_CENTER\n';
                nodeContent += '  adjust_mode: ADJUST_MODE_FIT\n';
                nodeContent += '  layer: ""\n';
                nodeContent += '  inherit_alpha: true\n';
                nodeContent += '  slice9 {\n';
                nodeContent += '    x: 0.0\n';
                nodeContent += '    y: 0.0\n';
                nodeContent += '    z: 0.0\n';
                nodeContent += '    w: 0.0\n';
                nodeContent += '  }\n';
                nodeContent += '  clipping_mode: CLIPPING_MODE_NONE\n';
                nodeContent += '  clipping_visible: true\n';
                nodeContent += '  clipping_inverted: false\n';
                nodeContent += '  alpha: 1.0\n';
                nodeContent += '  template_node_child: false\n';
                nodeContent += '  size_mode: SIZE_MODE_AUTO\n';
                nodeContent += '  custom_type: 0\n';
                nodeContent += '  enabled: true\n';
                nodeContent += '  visible: true\n';
                nodeContent += '  material: ""\n';
            }
            
            if (parent_name) {
                nodeContent += '  parent: "' + parent_name + '"\n';
            }
            
            nodeContent += '}\n';
            result += nodeContent;
            
            // Если это FRAME - рекурсивно обработать детей
            if (child.type === "FRAME" && child.children) {
                result += parseTemplateNodes(child, layerName, rootNode);
            }
        }
    }
    
    return result;
}

function createCollectionContent(selection) {
    // Начало содержимого файла
    collectionContent += 'name: "' + frame_name + '"\n';
    collectionContent += 'scale_along_z: 0\n';
    collectionContent += 'embedded_instances {\n';
    collectionContent += '  id: "go"\n';
    collectionContent += '  data: "components {\\n"\n';
    collectionContent += '  "  id: \\"monarch\\"\\n"\n';
    collectionContent += '  "  component: \\"/assets/' + frame_name + '/' + frame_name + '.gui\\"\\n"\n';
    collectionContent += '  "  position {\\n"\n';
    collectionContent += '  "    x: 0.0\\n"\n';
    collectionContent += '  "    y: 0.0\\n"\n';
    collectionContent += '  "    z: 0.0\\n"\n';
    collectionContent += '  "  }\\n"\n';
    collectionContent += '  "  rotation {\\n"\n';
    collectionContent += '  "    x: 0.0\\n"\n';
    collectionContent += '  "    y: 0.0\\n"\n';
    collectionContent += '  "    z: 0.0\\n"\n';
    collectionContent += '  "    w: 1.0\\n"\n';
    collectionContent += '  "}\\n"\n';
    collectionContent += '  "}\\n"\n';
    collectionContent += '  position {\n';
    collectionContent += '      x: 0.0\n';
    collectionContent += '      y: 0.0\n';
    collectionContent += '      z: 0.0\n';
    collectionContent += '  }\n';
    collectionContent += '  rotation {\n';
    collectionContent += '      x: 0.0\n';
    collectionContent += '      y: 0.0\n';
    collectionContent += '      z: 0.0\n';
    collectionContent += '      w: 1.0\n';
    collectionContent += '  }\n';
    collectionContent += '  scale3 {\n';
    collectionContent += '      x: 1.0\n';
    collectionContent += '      y: 1.0\n';
    collectionContent += '      z: 1.0\n';
    collectionContent += '  }\n';
    collectionContent += '}';
}

function createScriptFile(selection) {

    if (useDruid) {
        scriptContent += 'local druid = require("druid.druid")\n';
        if (layoutContainers.size > 0) {
            scriptContent += 'local layout = require("druid.extended.layout")\n';
        }
        scriptContent += '\n';
        
        // Generate callback placeholders
        if (instanceDataForClone.length > 0) {
             for (let data of instanceDataForClone) {
                 let instanceId = data.instanceId;
                 if (instanceId.toLowerCase().includes("button") || instanceId.toLowerCase().includes("btn")) {
                     scriptContent += 'local function on_' + instanceId + '_click(self)\n';
                     scriptContent += '    print("' + instanceId + ' clicked!")\n';
                     scriptContent += 'end\n\n';
                 }
             }
        }
    }

    scriptContent += 'function init(self)\n';
    if (useDruid) {
        scriptContent += '    self.druid = druid.new(self)\n';
    }
    scriptContent += '    self.MONARCH_ID = "' + frame_name + '"\n';
    scriptContent += '\n';
    scriptContent += '    msg.post(".", "acquire_input_focus")\n';
    scriptContent += '    gui.set_render_order(13)\n';
    scriptContent += '\n';
    
    // Initialize layouts
    if (useDruid && layoutContainers.size > 0) {
         scriptContent += '    -- Initialize layouts\n';
         for (let [id, data] of layoutContainers) {
             let mode = data.mode;
             if (data.isWrap) {
                 mode += '_wrap';
             }
             scriptContent += '    self.layout_' + id + ' = self.druid:new(layout, "' + id + '", "' + mode + '")\n';
             
             // Set margin based on orientation
             if (data.mode === 'vertical') {
                 scriptContent += '    self.layout_' + id + ':set_margin(0, ' + data.margin + ')\n';
             } else {
                 scriptContent += '    self.layout_' + id + ':set_margin(' + data.margin + ', 0)\n';
             }
             
             scriptContent += '    self.layout_' + id + ':set_padding(' + data.padding.left + ', ' + data.padding.top + ', ' + data.padding.right + ', ' + data.padding.bottom + ')\n';
         }
         scriptContent += '\n';
    }
    
    // Generate code to clone instances from templates
    if (instanceDataForClone.length > 0) {
        scriptContent += '    -- create template instances\n';
        scriptContent += '    self.instances = {}\n'; // Store instances if needed
        
        for (let data of instanceDataForClone) {
            let instanceId = data.instanceId;
            let templateName = data.templateName;
            let isButton = useDruid && (instanceId.toLowerCase().includes("button") || instanceId.toLowerCase().includes("btn"));
            
            scriptContent += '    \n';
            
            // local <instanceId> = gui.clone_tree(gui.get_node("<templateName>/<templateName>"))
            // We clone the root node of the template instance on the scene
            scriptContent += '    local ' + instanceId + ' = gui.clone_tree(gui.get_node("' + templateName + '/' + templateName + '"))\n';
            
            // Store instance
            scriptContent += '    self.instances["' + instanceId + '"] = ' + instanceId + '\n';
            
            // Define root node variable for convenience (templateName/templateName)
            scriptContent += '    local ' + instanceId + '_root = ' + instanceId + '["' + templateName + '/' + templateName + '"]\n';
            
            // gui.set_position(<instanceId>_root, vmath.vector3(x, y, 0)) - only if not in layout
            if (!(useDruid && data.parentName && layoutContainers.has(data.parentName))) {
                scriptContent += '    gui.set_position(' + instanceId + '_root, vmath.vector3(' + data.x + ', ' + data.y + ', 0))\n';
            }
            
            // gui.set_enabled(<instanceId>_root, true)
            scriptContent += '    gui.set_enabled(' + instanceId + '_root, true)\n';
            
            // Parenting
            if (data.parentName) {
                scriptContent += '    gui.set_parent(' + instanceId + '_root, gui.get_node("' + data.parentName + '"))\n';
            }
            
            // Add to layout if parent is a layout container and Druid is enabled
            if (useDruid && data.parentName && layoutContainers.has(data.parentName)) {
                scriptContent += '    self.layout_' + data.parentName + ':add(' + instanceId + '_root)\n';
            }
            
            // Create Druid button if applicable
            if (isButton) {
                scriptContent += '    self.druid:new_button(' + instanceId + '_root, self.on_' + instanceId + '_click)\n';
            }

            // Override texture if needed
            if (data.hasCustomTexture) {
                // gui.set_texture(<instanceId>_root, "<instanceId>")
                scriptContent += '    gui.set_texture(' + instanceId + '_root, "' + instanceId + '")\n';
            }

            // Set text if needed
            if (data.textContent) {
                var cleanTextContent = data.textContent.replace(/\r/g, "");
                var withTextContent = data.textContent.replace(/\n/g, "\\n");
                var textNodePath = templateName + '/text'; // Path to text node in the clone map

                if (/[\u0400-\u04FF]/.test(cleanTextContent) || /[a-zA-Z]/.test(cleanTextContent)) {
                    // Create lang key: FRAME_INSTANCEID_TEXT
                    var langKey = frame_name.toUpperCase() + '_' + instanceId.toUpperCase() + '_TEXT';
                    
                    // lang.set(instanceId["templateName/text"], "KEY")
                    scriptContent += '    lang.set(' + instanceId + '["' + textNodePath + '"], "' + langKey + '")\n';

                    // Collect for translation
                    var exists = false;
                    for(var t = 0; t < textsForTranslation.length; t++) {
                         if(textsForTranslation[t].key === langKey) {
                             exists = true;
                             break;
                         }
                    }
                    if (!exists) {
                         textsForTranslation.push({ key: langKey, text: cleanTextContent });
                    }
                } else {
                    // gui.set_text(instanceId["templateName/text"], "content")
                    scriptContent += '    gui.set_text(' + instanceId + '["' + textNodePath + '"], "' + withTextContent + '")\n';
                }
            }
        }
        
        // Refresh layouts after adding all elements
        if (useDruid && layoutContainers.size > 0) {
            scriptContent += '\n';
            for (let [id, data] of layoutContainers) {
                scriptContent += '    self.layout_' + id + ':refresh_layout()\n';
            }
        }
        
        scriptContent += '\n';
    }

    scriptContent += '    popup.set_animation(self, "background")\n';
    scriptContent += 'end\n';
    scriptContent += '\n';
    scriptContent += 'function on_message(self, message_id, message, sender)\n';
    if (useDruid) {
        scriptContent += '    self.druid:on_message(message_id, message, sender)\n';
    }
    scriptContent += '    -- модуль для работы всех поапов c монархом\n';
    scriptContent += '    popup.on_message_monarch(self, message_id, message, sender)\n';
    scriptContent += '    if message_id == hash("transition_show_in") then\n';
    scriptContent += '        local data = monarch.data(self.MONARCH_ID)\n';

    for (const node of selection) {
        if (node.type === "FRAME") {

            function iterateTree(node) {
                if (!node.children) {
                    return;
                }

                for (let child of node.children) {
                    if (child.name != "[exclude]") {
                        var layerName = child.name.replace(/\[corner\]/g, "");

                        // Handle INSTANCE nodes - iterate their children with instanceId prefix
                        if (child.type === "INSTANCE") {
                            // Instance creation and text setting is now handled in init() specific for clones
                            continue; 
                        }

                        if (child.type == "TEXT") {
                            var textContent = child.characters;
                            var cleanTextContent = textContent.replace(/\r/g, "");
                            var withTextContent = textContent.replace(/\n/g, "\\n");

                            if (/[\u0400-\u04FF]/.test(cleanTextContent) || /[a-zA-Z]/.test(cleanTextContent)) {
                                var langKey = frame_name.toUpperCase() + '_' + layerName.toUpperCase();
                                scriptContent += '        lang.set("' + layerName + '", "' + langKey + '")\n';
                                // Collect for translation
                                var exists = false;
                                for(var t = 0; t < textsForTranslation.length; t++) {
                                    if(textsForTranslation[t].key === langKey) {
                                        exists = true;
                                        break;
                                    }
                                }
                                if (!exists) {
                                    textsForTranslation.push({ key: langKey, text: cleanTextContent });
                                }
                            } else {
                                scriptContent += '        gui.set_text(gui.get_node("' + layerName + '"), "' + withTextContent + '")\n';
                            }
                        } else {
                            // scriptContent += '        ' + layerName + '\n';
                        }
                    }
                }

                scriptContent += '        \n';

                for (let child of node.children) {
                    if (child.name != "[exclude]") {
                        // Skip INSTANCE nodes - they're already handled above
                        if (child.type === "INSTANCE") {
                            continue;
                        }
                        // Если это FRAME - рекурсивно обработать детей
                        if (child.type === "FRAME" && child.children) {
                            iterateTree(child)
                        }
                    }
                }
            }

            iterateTree(node);
        }
    }



    scriptContent += '    end\n';
    scriptContent += 'end\n';
    scriptContent += '\n';

    // Druid final function
    if (useDruid) {
        scriptContent += 'function final(self)\n';
        scriptContent += '    self.druid:final()\n';
        scriptContent += 'end\n';
        scriptContent += '\n';
        scriptContent += 'function update(self, dt)\n';
        scriptContent += '    self.druid:update(dt)\n';
        scriptContent += 'end\n';
        scriptContent += '\n';
    }
    scriptContent += 'function on_input(self, action_id, action)\n';
    scriptContent += '    if action_id == hash("touch") then\n';

    for (const node of selection) {
        if (node.type === "FRAME") {
            function iterateTree(node) {
                for (let child of node.children) {
                    var layerName = child.name.replace(/\[corner\]/g, "");

                    if (child.name.includes("_btn")) {
                        scriptContent += '\n';
                        scriptContent += '        touch(self, action, "' + layerName + '", function()\n';
                        scriptContent += '            --msg.post("#", "hide")\n';
                        scriptContent += '        end)\n';
                    }

                    if (child.name != "[exclude]") {
                        // Если это FRAME - рекурсивно
                        if (child.type === "FRAME" && child.children) {
                            iterateTree(child)
                        }
                    }
                }
            }

            iterateTree(node);
        }
    }

    scriptContent += '\n';
    scriptContent += '    end\n';
    if (useDruid) {
        scriptContent += '    return self.druid:on_input(action_id, action)\n';
    }
    scriptContent += 'end\n';

    setTimeout(() => {
        SAVE_ALL();
    }, 1000);
}

function SAVE_ALL() {
    figma.ui.postMessage({
        type: "export",
        all_atlas_images: all_atlas_images,
        atlasContent: atlasContent,
        guiContent: guiContent,
        scriptContent: scriptContent,
        collectionContent: collectionContent,
        zipName: frame_name,
        textsForTranslation: textsForTranslation,
        autoTranslate: autoTranslate,
        apiKey: apiKey,
        languages: languages,
        googleSheetUrl: googleSheetUrl,
        templateGuiFiles: templateGuiFiles
    });
}

async function convertNodeToImage(node) {
    // Проверяем, что узел существует и у него есть размеры
    if (!node || !node.width || !node.height) {
        throw new Error('Invalid node or missing dimensions.');
    }

    // Создаем временный фрейм для размещения узла
    const tempFrame = figma.createFrame();
    tempFrame.appendChild(node);

    // Снимаем снимок временного фрейма в виде изображения
    const image = await tempFrame.exportAsync({ format: 'PNG' });

    // Удаляем временный фрейм
    tempFrame.remove();

    // Преобразуем изображение в UInt8Array
    const uint8Array = new Uint8Array(image);

    return uint8Array;
}


function startExport(selection) {
    if (!selection || selection.length == 0) {
        figma.notify("Пожалуйста, выделите фрейм!");
    }
    else {
        // очищаем
        frame_name = '';
        all_atlas_images = [];
        atlasContent = '';
        guiContent = '';
        scriptContent = '';
        collectionContent = '';
        textsForTranslation = [];
        emptyContainerIds.clear();
        templateGuiFiles = [];
        processedComponentIds.clear();
        exportedComponentIds.clear();
        addedHiddenTemplates.clear();
        instanceDataForClone = [];
        layoutContainers.clear();

        exportLayersToPNG(selection);
    }
}

function applySettings(s) {
    if (!s) return;
    target_project = { width: s.width || 1080, height: s.height || 1920 };
    target_project_fonts = s.fonts || target_project_fonts;
    is_use_background_node = s.useBackground !== false;
    max_font_scale = s.maxFontScale || 60;
    apiKey = s.apiKey || "";
    languages = s.languages || "en,ru,de,fr,es,pt,ko,ja";
    useDruid = s.useDruid !== false;
    googleSheetUrl = s.googleSheetUrl || "";
    autoTranslate = s.autoTranslate === true;
    exportSettings = updateExportSettings();
}

async function handleMessage(msg) {
    if (msg.type === 'loadSettings') {
        const saved = await figma.clientStorage.getAsync('pluginSettings');
        figma.ui.postMessage({ type: 'settingsLoaded', settings: saved });
    } else if (msg.type === 'saveSettings') {
        await figma.clientStorage.setAsync('pluginSettings', msg.settings);
        applySettings(msg.settings);
    } else if (msg.type === 'export') {
        applySettings(msg.settings);
        await figma.clientStorage.setAsync('pluginSettings', msg.settings);
        let selection = Array.from(figma.currentPage.selection);
        startExport(selection);
    } else if (msg.type === 'testApi') {
        // Test DeepSeek API connection
        figma.ui.postMessage({ type: 'apiTestResult', success: true });
    } else if (msg.type === 'loadTranslationCache') {
        const cache = await figma.clientStorage.getAsync('translationCache');
        figma.ui.postMessage({ type: 'translationCacheLoaded', cache: cache || {} });
    } else if (msg.type === 'saveTranslationCache') {
        await figma.clientStorage.setAsync('translationCache', msg.cache);
    }
}

if (figma.editorType === 'figma') {
    figma.showUI(__html__);
    figma.ui.resize(320, 570);
    figma.ui.onmessage = msg => handleMessage(msg);
}