/*
 * The early-access form on the apex coming-soon page.
 *
 * The page itself is a static file served by Caddy, so the questions cannot be
 * rendered into it at build time — a super admin changes them at
 * /admin/settings whenever they like. They are fetched instead from
 * /api/early-access, which Caddy proxies to the Next.js app on the same
 * origin (see deploy/Caddyfile.production).
 *
 * Everything here degrades quietly. If the app is down, the endpoint 404s or
 * the form is switched off, the page simply shows no button and stays a
 * perfectly good marketing page — which is the whole reason it is static.
 * The <noscript> mailto in index.html covers a reader with JavaScript off.
 *
 * No dependencies, no build step: this file is served exactly as written.
 */
(function () {
  'use strict';

  var mount = document.getElementById('early-access');
  if (!mount || !window.fetch) return;

  var ENDPOINT = '/api/early-access';

  /** Text nodes only — never innerHTML with anything server-supplied. */
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (attrs[key] !== null && attrs[key] !== undefined) {
          node.setAttribute(key, attrs[key]);
        }
      });
    }
    if (text) node.appendChild(document.createTextNode(text));
    return node;
  }

  function message(kind, text) {
    var p = el('p', { class: 'form-message', 'data-kind': kind, role: kind === 'error' ? 'alert' : 'status' }, text);
    return p;
  }

  function fieldFor(question) {
    var wrap = el('div', { class: 'field' });
    var id = 'q-' + question.id;

    wrap.appendChild(el('label', { for: id }, question.label + (question.required ? ' *' : '')));
    if (question.help) wrap.appendChild(el('span', { class: 'hint' }, question.help));

    // "Select all that apply" is a group of checkboxes rather than one
    // control, so it gets a fieldset and no single element to hang `required`
    // or an id on. The label above is turned into the group's caption.
    if (question.type === 'multi') {
      var group = el('div', { class: 'checkboxes', role: 'group', 'aria-labelledby': id + '-label' });
      wrap.firstChild.setAttribute('id', id + '-label');
      (question.options || []).forEach(function (option, index) {
        var optionId = id + '-' + index;
        var line = el('label', { class: 'checkbox', for: optionId });
        line.appendChild(el('input', {
          type: 'checkbox', id: optionId, name: question.id, value: option,
        }));
        line.appendChild(document.createTextNode(' ' + option));
        group.appendChild(line);
      });
      wrap.appendChild(group);
      return wrap;
    }

    var input;
    if (question.type === 'long') {
      input = el('textarea', { id: id, name: question.id, rows: '3' });
    } else if (question.type === 'select') {
      input = el('select', { id: id, name: question.id });
      // A blank first option, so a select never answers itself by accident.
      input.appendChild(el('option', { value: '' }, question.required ? 'Choose one…' : '(no answer)'));
      (question.options || []).forEach(function (option) {
        input.appendChild(el('option', { value: option }, option));
      });
    } else {
      input = el('input', { type: 'text', id: id, name: question.id });
    }
    if (question.required) input.setAttribute('required', 'required');

    wrap.appendChild(input);
    return wrap;
  }

  function buildForm(definition) {
    // No novalidate: the browser's own required/type=email checks are worth
    // having, and the endpoint revalidates everything regardless.
    var form = el('form', { class: 'request-form' });

    if (definition.intro) form.appendChild(el('p', { class: 'intro' }, definition.intro));

    var emailWrap = el('div', { class: 'field' });
    emailWrap.appendChild(el('label', { for: 'q-email' }, 'Email address *'));
    emailWrap.appendChild(el('input', {
      type: 'email', id: 'q-email', name: 'email', required: 'required', autocomplete: 'email',
    }));
    form.appendChild(emailWrap);

    var nameWrap = el('div', { class: 'field' });
    nameWrap.appendChild(el('label', { for: 'q-name' }, 'Name'));
    nameWrap.appendChild(el('input', {
      type: 'text', id: 'q-name', name: 'name', autocomplete: 'name',
    }));
    form.appendChild(nameWrap);

    (definition.questions || []).forEach(function (question) {
      form.appendChild(fieldFor(question));
    });

    // Honeypot. Not a security control on its own — the endpoint rate-limits
    // by IP regardless — just a cheap filter on the dumbest traffic.
    var hp = el('div', { class: 'hp', 'aria-hidden': 'true' });
    hp.appendChild(el('label', { for: 'q-website' }, 'Leave this empty'));
    hp.appendChild(el('input', { type: 'text', id: 'q-website', name: 'website', tabindex: '-1', autocomplete: 'off' }));
    form.appendChild(hp);

    var submit = el('button', { type: 'submit', class: 'btn' }, 'Send request');
    form.appendChild(submit);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Sending…';

      // namedItem, not form.elements[id]: the collection has its own `length`,
      // `item` and `namedItem` properties, so a question whose id happened to
      // be one of those would read the collection's member instead of the
      // input. (The fixed field names are separately reserved server-side, so
      // a question can never collide with email/name/website either.)
      function field(name) {
        return form.elements.namedItem(name);
      }

      var answers = {};
      (definition.questions || []).forEach(function (question) {
        // A checkbox group shares one name across several inputs, so
        // namedItem returns a RadioNodeList rather than an element and
        // reading .value off it would give only the first ticked box.
        if (question.type === 'multi') {
          var ticked = [];
          // Walked rather than selected, so no question id ever has to be
          // escaped into a CSS attribute selector.
          Array.prototype.forEach.call(form.elements, function (element) {
            if (element.type === 'checkbox'
              && element.name === question.id
              && element.checked) {
              ticked.push(element.value);
            }
          });
          if (ticked.length) answers[question.id] = ticked;
          return;
        }
        var node = field(question.id);
        if (node && node.value.trim()) answers[question.id] = node.value.trim();
      });

      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: field('email').value,
          name: field('name').value,
          answers: answers,
          website: field('website').value,
        }),
      }).then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      }).then(function (result) {
        if (result.ok && result.data && result.data.ok) {
          mount.textContent = '';
          mount.appendChild(message(
            'ok',
            'Thanks — your request has been received. We will be in touch as places open up.',
          ));
          return;
        }
        submit.disabled = false;
        submit.textContent = 'Send request';
        var existing = form.querySelector('.form-message');
        if (existing) existing.remove();
        form.insertBefore(
          message('error', (result.data && result.data.error) || 'Something went wrong. Please try again.'),
          form.firstChild,
        );
      }).catch(function () {
        submit.disabled = false;
        submit.textContent = 'Send request';
        var existing = form.querySelector('.form-message');
        if (existing) existing.remove();
        form.insertBefore(
          message('error', 'Could not reach the server. Please try again shortly.'),
          form.firstChild,
        );
      });
    });

    return form;
  }

  fetch(ENDPOINT, { headers: { Accept: 'application/json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('unavailable');
      return response.json();
    })
    .then(function (definition) {
      if (!definition || !definition.open) return;

      // The button, not the form: a form sitting open under the hero competes
      // with the page's actual job, which is to explain what AFLDB is.
      //
      // Its wording comes from the page rather than from the endpoint, via a
      // data attribute the publisher writes (see apex-html.ts). The endpoint
      // serves the QUESTIONS; the copy around them is part of the page and is
      // edited with the rest of it at /admin/content. The literal below is
      // the fallback for the hand-written index.html in this directory, which
      // carries no attribute.
      var label = mount.getAttribute('data-label') || 'Request early access';
      var button = el('button', { type: 'button', class: 'btn' }, label);
      button.addEventListener('click', function () {
        mount.textContent = '';
        var form = buildForm(definition);
        mount.appendChild(form);
        var first = form.querySelector('input, textarea, select');
        if (first) first.focus();
      });
      mount.appendChild(button);
    })
    .catch(function () {
      // Deliberately silent: no button, no error. The page stands alone.
    });
}());
