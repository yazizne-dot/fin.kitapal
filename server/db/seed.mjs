export function seedDemoData(db, insert, orgs, audit) {
  let id = 0;
  const add = (o) =>
    insert.run({
      external_id: `demo-${++id}`,
      source: "demo",
      date: "2025-01-01",
      org: orgs[0],
      point: "Алматы",
      counterparty: "",
      document: `INIT-${id}`,
      kind: "capital",
      amount: 1,
      cost: 0,
      due: "",
      article: "",
      ...o,
    });
  for (let j = 0; j < 3; j++) {
    let org = orgs[j],
      point = ["Алматы", "Астана", "Шымкент"][j];
    let base = { org, point };
    add({ ...base, amount: 18000000, article: "Құрылтайшы капиталы" });
    add({ ...base, kind: "loan", amount: 5000000, article: "Банк қарызы" });
    add({ ...base, kind: "asset", amount: 4500000, article: "Жабдықтар" });
    for (let year = 2025; year <= 2026; year++)
      for (let m = 1; m <= 12; m++) {
        if (year === 2026 && m > 9) continue;
        const month = `${year}-${String(m).padStart(2, "0")}`;
        const rev = Math.round(
          (6500000 + j * 950000 + m * 125000) * (year === 2026 ? 1.19 : 1),
        );
        const cost = Math.round(rev * 0.51);
        const cp = ["Meloman", "Flip.kz", "Кітап дүкендері"][j];
        const doc = `SALE-${year}-${m}-${j}`;
        const pdoc = `BUY-${year}-${m}-${j}`;
        const exp = Math.round(rev * 0.245);
        add({
          ...base,
          date: month + "-02",
          kind: "purchase",
          amount: cost + 180000,
          counterparty: "Баспа жеткізушілері",
          document: pdoc,
          article: "Тауарлар",
          due: month + "-20",
        });
        add({
          ...base,
          date: month + "-05",
          kind: "sale",
          amount: rev,
          cost,
          counterparty: cp,
          document: doc,
          article: "Кітап сату",
          due: month + "-25",
        });
        add({
          ...base,
          date: month + "-10",
          kind: "receipt",
          amount: Math.round(rev * (m === 9 && year === 2026 ? 0.78 : 0.98)),
          counterparty: cp,
          document: doc,
          article: "Клиенттерден түсім",
        });
        add({
          ...base,
          date: month + "-15",
          kind: "supplier_payment",
          amount: cost + 100000,
          counterparty: "Баспа жеткізушілері",
          document: pdoc,
          article: "Жеткізушілерге төлем",
        });
        for (const [a, f] of [
          ["Еңбекақы", 0.52],
          ["Жалдау", 0.28],
          ["Маркетинг", 0.12],
          ["Логистика", 0.08],
        ]) {
          const edoc = `EXP-${year}-${m}-${j}-${a}`,
            amount = Math.round(exp * f);
          add({
            ...base,
            date: month + "-18",
            kind: "expense",
            amount,
            counterparty: a,
            document: edoc,
            article: a,
            due: month + "-20",
          });
          add({
            ...base,
            date: month + "-20",
            kind: "expense_payment",
            amount,
            counterparty: a,
            document: edoc,
            article: a,
          });
        }
        add({
          ...base,
          date: month + "-25",
          kind: "depreciation",
          amount: 50000,
          article: "Амортизация",
        });
        // Explicit demo tax accrual, not a statutory tax-rate calculation.
        add({
          ...base,
          date: month + "-25",
          kind: "tax",
          amount: 180000 + j * 20000,
          article: "Бухгалтерия енгізген салық",
        });
        add({
          ...base,
          date: month + "-26",
          kind: "tax_payment",
          amount: 180000 + j * 20000,
          article: "Салық төлемі",
        });
      }
  }
  for (let j = 0; j < 3; j++)
    for (let day = 1; day <= 28; day += 3)
      db.prepare(
        "INSERT INTO plans(date,org,article,amount,direction) VALUES(?,?,?,?,?)",
      ).run(
        `2026-10-${String(day).padStart(2, "0")}`,
        orgs[j],
        day % 2 ? "Клиенттің күтілетін төлемі" : "Жоспарлы төлем",
        (day % 2 ? 1100000 : 1800000) + j * 100000,
        day % 2 ? "in" : "out",
      );
  audit(
    { name: "Жүйе" },
    "Демо-деректер",
    "Бастапқы демонстрациялық жинақ жасалды",
  );
}
