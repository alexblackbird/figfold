// если в названии есть [exclude] - не работает со слоем
// если в названии есть [p] - это парнет - группирует в себе другие объекты

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

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) { function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); } return new (P || (P = Promise))(function (resolve, reject) { function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } } function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } } function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); } step((generator = generator.apply(thisArg, _arguments || [])).next()); }); };

var frame_name = "";
var all_atlas_images = [];
var atlasContent = '';
var guiContent = '';
var scriptContent = '';
var collectionContent = '';

function updateExportSettings() {
    return {
        format: "PNG",
        constraint: { type: "SCALE", value: SCALE }
    };
}
var exportSettings = updateExportSettings();

// Экспортируем слои как PNG изображения
async function exportLayer(node) {
    let originalSizes = {};

    for (let child of node.children) {

        if (child.type !== "TEXT" && child.name !== "[exclude]") {
            try {
                // Если это parent - содержит [p]
                if (child.name.includes("[p]") && child.children) {
                    for (let grandchild of child.children) {
                        grandchild.visible = false;
                    }
                }

                if (child.name.includes("[corner]")) {
                    originalSizes[child.id] = {
                        width: child.width,
                        height: child.height,
                    };

                    const newSize = child.cornerRadius * 2;
                    child.resize(newSize, newSize);
                }

                const value = await child.exportAsync(exportSettings);

                // Удаление "[corner]" из имени файла
                const fileName = child.name.replace(/\[corner\]/g, "").replace(/\[p\]/g, "") + ".png";

                all_atlas_images.push({
                    name: fileName,
                    value: value,
                });

                if (child.name.includes("[corner]")) {
                    child.resize(originalSizes[child.id].width, originalSizes[child.id].height);
                }

                // Теперь если это было с [p] - нужно все включить и для каждого сделать тоже работу
                if (child.name.includes("[p]") && child.children) {

                    for (let grandchild of child.children) {
                        grandchild.visible = true;
                    }
                    await exportLayer(child);
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
    guiContent += 'textures {\n';
    guiContent += '  name: "ui"\n';
    guiContent += '  texture: "/assets/ui.atlas"\n';
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
    if (!node.children) {
        return;
    }

    for (let child of node.children) {
        if (child.name != "[exclude]") {
            var layerName = child.name.replace(/\[corner\]/g, "").replace(/\[p\]/g, "");
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

            if (child.type === "TEXT") {
                // если есть отличия в пивоте то нужно изменять положение текста
                let horizontalAlignment = child.textAlignHorizontal;
                var textSize = child.fontSize;
                var text_scale = textSize / max_font_scale;
                var textWidth = child.width / text_scale;
                var textHeight = child.height / text_scale;

                if (horizontalAlignment === "LEFT") {
                    layerPosition.x -= textWidth / 4
                } else if (horizontalAlignment === "RIGHT") {
                    layerPosition.x += textWidth / 4
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
            guiContent += 'outline_alpha: 1.0\n';
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
            if (child.name.includes("[corner]")) {

                let size_width = child.width
                let size_height = child.height
                // если у объекта есть тень
                // TODO сделать поддержку тени со смещением
                if (child.effects && child.effects.length > 0) {
                    for (let effect of child.effects) {
                        if (effect.type === "DROP_SHADOW") {
                            size_width += effect.radius * 2
                            size_height += effect.radius * 2
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
            guiContent += '  texture: "' + frame_name + '/' + layerName + '"\n';
            guiContent += '  id: "' + layerName + '"\n';
            guiContent += '  xanchor: XANCHOR_NONE\n';
            guiContent += ' yanchor: YANCHOR_NONE\n';
            guiContent += '  pivot: PIVOT_CENTER\n';
            guiContent += ' adjust_mode: ADJUST_MODE_FIT\n';
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

            if (child.name.includes("[corner]")) {
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

        if (child.name.includes("[p]") && child.children) {
            parseNodeOfTree(child, layerName)
        }
    }
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

    scriptContent += 'function init(self)\n';
    scriptContent += '    self.MONARCH_ID = "' + frame_name + '"\n';
    scriptContent += '\n';
    scriptContent += '    msg.post(".", "acquire_input_focus")\n';
    scriptContent += '    gui.set_render_order(13)\n';
    scriptContent += '\n';
    scriptContent += '    -- инциализация анимации\n';
    scriptContent += '    popup.set_animation(self, "background")\n';
    scriptContent += 'end\n';
    scriptContent += '\n';
    scriptContent += 'function on_message(self, message_id, message, sender)\n';
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
                        var layerName = child.name.replace(/\[corner\]/g, "").replace(/\[p\]/g, "");

                        if (child.type == "TEXT") {
                            var textContent = child.characters;
                            var cleanTextContent = textContent.replace(/\r/g, "");
                            var withTextContent = textContent.replace(/\n/g, "\\n");

                            if (/[\u0400-\u04FF]/.test(cleanTextContent) || /[a-zA-Z]/.test(cleanTextContent)) {
                                scriptContent += '        lang.set("' + layerName + '", "' + frame_name.toUpperCase() + '_' + layerName.toUpperCase() + '")\n';
                            } else {
                                scriptContent += '        gui.set_text(gui.get_node("' + layerName + '"), ' + withTextContent + ')\n';
                            }
                        } else {
                            // scriptContent += '        ' + layerName + '\n';
                        }
                    }
                }

                scriptContent += '        \n';

                for (let child of node.children) {
                    if (child.name != "[exclude]") {
                        if (child.name.includes("[p]")) {
                            iterateTree(child)
                        }
                    }
                }
            }

            iterateTree(node);
        }
    }

    scriptContent += '        --[[\n';

    for (const node of selection) {
        if (node.type === "FRAME") {

            function iterateTree(node) {
                if (!node.children) {
                    return;
                }

                for (let child of node.children) {
                    if (child.name != "[exclude]") {
                        var layerName = child.name.replace(/\[corner\]/g, "").replace(/\[p\]/g, "");

                        if (child.type == "TEXT") {
                            var textContent = child.characters;
                            var cleanTextContent = textContent.replace(/\r/g, "");
                            var withTextContent = textContent.replace(/\n/g, "\\n");

                            if (/[\u0400-\u04FF]/.test(cleanTextContent) || /[a-zA-Z]/.test(cleanTextContent)) {
                                scriptContent += '        Переведи этот текст "' + withTextContent + '" на en ru de	fr	it	es	pt	ko	ja	ar	tr в контексте в формате csv\n';
                            }
                        }
                    }
                }

                for (let child of node.children) {
                    if (child.name != "[exclude]") {
                        if (child.name.includes("[p]")) {
                            iterateTree(child)
                        }
                    }
                }
            }

            iterateTree(node);
        }
    }

    for (const node of selection) {
        if (node.type === "FRAME") {

            function iterateTree(node) {
                if (!node.children) {
                    return;
                }

                for (let child of node.children) {
                    if (child.name != "[exclude]") {
                        var layerName = child.name.replace(/\[corner\]/g, "").replace(/\[p\]/g, "");

                        if (child.type == "TEXT") {
                            var textContent = child.characters;
                            var cleanTextContent = textContent.replace(/\r/g, "");
                            var withTextContent = textContent.replace(/\n/g, "\\n");

                            if (/[\u0400-\u04FF]/.test(cleanTextContent) || /[a-zA-Z]/.test(cleanTextContent)) {
                                scriptContent += '        ' + frame_name.toUpperCase() + '_' + layerName.toUpperCase() + '\n';
                            }
                        }
                    }
                }

                for (let child of node.children) {
                    if (child.name != "[exclude]") {
                        if (child.name.includes("[p]")) {
                            iterateTree(child)
                        }
                    }
                }
            }

            iterateTree(node);
        }
    }

    scriptContent += '        ]]\n';

    scriptContent += '    end\n';
    scriptContent += 'end\n';
    scriptContent += '\n';
    scriptContent += 'function on_input(self, action_id, action)\n';
    scriptContent += '    if action_id == hash("touch") then\n';

    for (const node of selection) {
        if (node.type === "FRAME") {
            function iterateTree(node) {
                for (let child of node.children) {
                    var layerName = child.name.replace(/\[corner\]/g, "").replace(/\[p\]/g, "");

                    if (child.name.includes("_btn")) {
                        scriptContent += '\n';
                        scriptContent += '        touch(self, action, "' + layerName + '", function()\n';
                        scriptContent += '            --msg.post("#", "hide")\n';
                        scriptContent += '        end)\n';
                    }

                    if (child.name != "[exclude]") {
                        if (child.name.includes("[p]")) {
                            iterateTree(child)
                        }
                    }
                }
            }

            iterateTree(node);
        }
    }

    scriptContent += '\n';
    scriptContent += '        return true\n';
    scriptContent += '    end\n';
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
        zipName: frame_name
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

        exportLayersToPNG(selection);
    }
}

function applySettings(s) {
    if (!s) return;
    SCALE = s.scale || 1;
    target_project = { width: s.width || 1080, height: s.height || 1920 };
    target_project_fonts = s.fonts || target_project_fonts;
    is_use_background_node = s.useBackground !== false;
    max_font_scale = s.maxFontScale || 60;
    apiKey = s.apiKey || "";
    languages = s.languages || "en,ru,de,fr,es,pt,ko,ja";
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
    }
}

if (figma.editorType === 'figma') {
    figma.showUI(__html__);
    figma.ui.resize(320, 520);
    figma.ui.onmessage = msg => handleMessage(msg);
}