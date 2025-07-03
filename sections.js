const sections = [
  "Лист изменений",
  "Глоссарий (опционально)",
  "Предмет разработки",
  "Релиз конфигурации",
  "Дизайн объектов Системы",
  "Описание общих алгоритмов",
  "Описание интеграционных интерфейсов",
  "Техническая реализация",
  "Настройки системы, используемые разработкой",
  "Тестовый сценарий",
];

const findMdLinks = (text) => {
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  const links = [];
  while ((match = regex.exec(text)) !== null) {
    links.push({ text: match[1], id: match[2] });
  }
  return links;
};

const findNextSection = (currentSection, sections) => {
  let currentIndex = sections.findIndex(
    (section) => section.section === currentSection
  );
  if (currentIndex === -1 || currentIndex === sections.length - 1) {
    return null;
  }
  while (currentIndex < sections.length - 1) {
    const nextSection = sections[currentIndex + 1];
    if (nextSection.id) {
      return nextSection;
    }
    currentIndex++;
  }
  return null;
};

const findPreviousLinebreak = (text, position) => {
  const previousLinebreak = text.lastIndexOf("\n", position - 1);
  if (previousLinebreak === -1) {
    return 0; // Если нет предыдущего разрыва строки, начинаем с начала
  }
  return previousLinebreak + 1; // Возвращаем позицию после разрыва
};

const findMdAnchors = (text) => {
  const regex = /<a id="([^"]+)"><\/a>/g;
  let match;
  const anchors = [];
  while ((match = regex.exec(text)) !== null) {
    anchors.push({
      id: match[1],
      position: findPreviousLinebreak(text, match.index),
      fullMatch: match[0],
    });
  }
  return anchors;
};

const getSections = (md) => {
  const anchors = findMdAnchors(md);
  const links = findMdLinks(md);
  const result = sections.map((section) => {
    const sectionLink = links.find((link) => link.text.includes(section));
    return {
      section,
      text: "",
      id: sectionLink ? sectionLink.id : null,
      position: anchors.find((anchor) => `#${anchor.id}` === sectionLink?.id)
        ?.position,
    };
  });
  for (const section of result) {
    if (!section.id) {
      continue;
    }
    const nextSection = findNextSection(section.section, result);
    section.text = md.substring(
      section.position,
      nextSection ? nextSection.position : undefined
    );
  }
  return result;
};

for (const item of $input.all()) {
  item.json.sections = getSections(item.json.text);
}

return $input.all();
