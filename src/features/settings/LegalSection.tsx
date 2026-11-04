import { Fragment } from 'react';
import { legalDocuments, legalNotice, legalPlaceholders } from '../../content/legal';
import { AlertIcon } from '../../design-system/icons';

const placeholderPattern = new RegExp(`(${legalPlaceholders.join('|')})`);
/** 数と単位（「24か月」「約100m単位」など）。文節で折り返すと「24か / 月」と分かれるので、ひとまとまりにする。 */
const quantityPattern = /((?:約|最長)?\d+(?:か月|日間|日|人|m単位|分|時間|歳))/;

function Quantities({ text }: { text: string }) {
  return <>{text.split(quantityPattern).map((part, index) => index % 2 === 1 ? <span className="phrase" key={index}>{part}</span> : <Fragment key={index}>{part}</Fragment>)}</>;
}

/** 空欄の印だけを目立たせて、文を組み立てる。 */
function LegalText({ text }: { text: string }) {
  return <>{text.split(placeholderPattern).map((part, index) => <Fragment key={index}>{legalPlaceholders.includes(part as typeof legalPlaceholders[number]) ? <mark className="legal-placeholder">{part}</mark> : <Quantities text={part}/>}</Fragment>)}</>;
}

/** 利用規約とプライバシーポリシーの草案。本文は構造化したデータから組み立てる。 */
export default function LegalSection() {
  return <div className="stack legal">
    <div className="callout" role="note"><AlertIcon/><div><strong>草案</strong><p className="small mb-0">{legalNotice}</p></div></div>
    <nav className="segmented legal-links" aria-label="文書">{legalDocuments.map((document) => <a data-control-id={`settings.legal.jump.${document.id}`} className="button" href={`#legal-${document.id}`} key={document.id}>{document.title}</a>)}</nav>
    {legalDocuments.map((document) => <article className="card" id={`legal-${document.id}`} key={document.id} aria-labelledby={`legal-title-${document.id}`}>
      <h2 id={`legal-title-${document.id}`}>{document.title}</h2>
      <p><LegalText text={document.intro}/></p>
      {document.sections.map((section) => <section key={section.heading}>
        <h3>{section.heading}</h3>
        {section.paragraphs.map((text) => <p key={text}><LegalText text={text}/></p>)}
        {section.items && <ul>{section.items.map((text) => <li key={text}><LegalText text={text}/></li>)}</ul>}
      </section>)}
    </article>)}
  </div>;
}
